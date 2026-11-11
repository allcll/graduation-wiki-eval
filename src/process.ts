import { spawn } from "node:child_process";

// Larger setTimeout delays wrap to 1 ms in Node instead of waiting longer.
export const MAX_TIMEOUT_MS = 2_147_483_647;
export const TERMINATION_GRACE_MS = 500;
const FORWARDED_TERMINATION_GRACE_MS = 250;

type ForwardedSignal = "SIGINT" | "SIGTERM";

export class ProcessInterruptedError extends Error {
  override name = "ProcessInterruptedError";

  constructor(readonly signal: ForwardedSignal) {
    super(`Adapter execution interrupted by ${signal}`);
  }
}

export interface ProcessOptions {
  cwd: string;
  input: string;
  timeoutMs: number;
  env?: NodeJS.ProcessEnv;
  maxOutputBytes?: number;
  /** CLI callers opt in to cleanup on SIGINT/SIGTERM; interruption rejects. */
  forwardSignals?: boolean;
  /** A supervisor needs a longer grace than its nested adapter (default 250 ms). */
  signalGraceMs?: number;
}

export interface ProcessResult {
  stdout: string;
  stderr: string;
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  timedOut: boolean;
  outputLimitExceeded: boolean;
}

/** Execute a trusted adapter. Process-group cleanup is not an OS sandbox. */
export async function runProcess(
  command: readonly string[],
  options: ProcessOptions,
): Promise<ProcessResult> {
  if (process.platform === "win32") {
    throw new Error("Adapter execution requires POSIX process groups (macOS/Linux)");
  }
  const executable = command[0];
  if (!executable || command.some((arg) => typeof arg !== "string")) {
    throw new Error("Adapter command must be a nonempty argv list");
  }
  if (!Number.isFinite(options.timeoutMs) || options.timeoutMs <= 0 || options.timeoutMs > MAX_TIMEOUT_MS) {
    throw new Error(`Process timeout must be positive and at most ${MAX_TIMEOUT_MS} ms`);
  }
  const maxOutputBytes = options.maxOutputBytes ?? 8 * 1024 * 1024;
  if (!Number.isSafeInteger(maxOutputBytes) || maxOutputBytes <= 0) {
    throw new Error("Process output limit must be a positive safe integer");
  }
  const signalGraceMs = options.signalGraceMs ?? FORWARDED_TERMINATION_GRACE_MS;
  if (!Number.isFinite(signalGraceMs) || signalGraceMs < 0 || signalGraceMs > MAX_TIMEOUT_MS) {
    throw new Error(`Signal grace must be between 0 and ${MAX_TIMEOUT_MS} ms`);
  }

  return new Promise((resolve, reject) => {
    const child = spawn(executable, command.slice(1), {
      cwd: options.cwd,
      env: options.env ?? process.env,
      shell: false,
      detached: true,
      stdio: ["pipe", "pipe", "pipe"],
    });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    let capturedBytes = 0;
    let timedOut = false;
    let outputLimitExceeded = false;
    let finished = false;
    let interruptedSignal: ForwardedSignal | undefined;
    let escalation: ReturnType<typeof setTimeout> | undefined;
    let escalationDeadline = Number.POSITIVE_INFINITY;

    const killGroup = (signal: NodeJS.Signals = "SIGKILL"): void => {
      if (child.pid === undefined) return;
      try {
        process.kill(-child.pid, signal);
      } catch (error: unknown) {
        // A group that already exited needs no cleanup. Other errors still
        // require attempting to stop the direct child.
        if (!(error instanceof Error && "code" in error && error.code === "ESRCH")) {
          child.kill(signal);
        }
      }
    };
    const terminate = (graceMs = TERMINATION_GRACE_MS): void => {
      if (finished) return;
      const deadline = performance.now() + graceMs;
      if (deadline >= escalationDeadline) return;
      // The adapter may itself be supervising Claude in another process group.
      // Give its signal handler time to terminate that group before escalation.
      if (escalation === undefined) killGroup("SIGTERM");
      clearTimeout(escalation);
      escalationDeadline = deadline;
      escalation = setTimeout(() => {
        killGroup();
        // A descendant that deliberately escaped the group can keep a pipe
        // open. Bound our wait even then; this is still not an OS sandbox.
        child.stdin.destroy();
        child.stdout.destroy();
        child.stderr.destroy();
      }, graceMs);
    };
    const onInterrupt = (): void => {
      interruptedSignal ??= "SIGINT";
      terminate(signalGraceMs);
    };
    const onTerminate = (): void => {
      interruptedSignal ??= "SIGTERM";
      // A supervising runner uses the longer timeout grace. Finish this
      // nested group's escalation first, even if its child ignores SIGTERM.
      terminate(signalGraceMs);
    };
    if (options.forwardSignals) {
      process.on("SIGINT", onInterrupt);
      process.on("SIGTERM", onTerminate);
    }
    const timer = setTimeout(() => {
      timedOut = true;
      terminate();
    }, options.timeoutMs);
    const cleanup = (): void => {
      clearTimeout(timer);
      clearTimeout(escalation);
      if (options.forwardSignals) {
        process.off("SIGINT", onInterrupt);
        process.off("SIGTERM", onTerminate);
      }
      killGroup();
    };
    const collect = (target: Buffer[], chunk: Buffer): void => {
      const remaining = maxOutputBytes - capturedBytes;
      if (remaining > 0) {
        const kept = chunk.subarray(0, remaining);
        target.push(kept);
        capturedBytes += kept.byteLength;
      }
      if (chunk.byteLength > remaining) {
        outputLimitExceeded = true;
        terminate();
      }
    };
    child.stdout.on("data", (chunk: Buffer) => collect(stdout, chunk));
    child.stderr.on("data", (chunk: Buffer) => collect(stderr, chunk));
    child.stdin.on("error", () => {
      // An adapter may exit before consuming stdin; its exit status is the
      // outcome. Listening here prevents an unhandled EPIPE error.
    });
    child.on("error", (error: Error) => {
      if (finished) return;
      finished = true;
      cleanup();
      reject(interruptedSignal ? new ProcessInterruptedError(interruptedSignal) : error);
    });
    child.on("exit", () => {
      // A successfully exited parent can leave descendants holding the pipes.
      // Stop ordinary descendants before waiting for the close event.
      killGroup();
    });
    child.on("close", (exitCode, signal) => {
      if (finished) return;
      finished = true;
      cleanup();
      if (interruptedSignal) {
        reject(new ProcessInterruptedError(interruptedSignal));
        return;
      }
      resolve({
        stdout: Buffer.concat(stdout).toString("utf8"),
        stderr: Buffer.concat(stderr).toString("utf8"),
        exitCode,
        signal,
        timedOut,
        outputLimitExceeded,
      });
    });
    child.stdin.end(options.input);
  });
}
