import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import type { TestContext } from 'node:test';

const realSetTimeout = globalThis.setTimeout;
const startupLimitMs = 15_000;

export const pause = (ms: number): Promise<void> => new Promise((resolve) => realSetTimeout(resolve, ms));

/** Delay only the first deadline until the real child signals readiness.
 * Escalation timers and signal handling keep using the real clock. */
export function controlledDeadline(t: TestContext, timeoutMs: number): { expire: () => void } {
  let expire: (() => void) | undefined;
  const timer = t.mock.method(globalThis, 'setTimeout',
    (callback: (...args: unknown[]) => void, ms?: number, ...args: unknown[]) => {
      if (ms !== timeoutMs || expire !== undefined) return realSetTimeout(callback, ms, ...args);
      let fired = false;
      const fire = () => {
        if (fired) return;
        fired = true;
        clearTimeout(watchdog);
        callback(...args);
      };
      const watchdog = realSetTimeout(fire, startupLimitMs * 2);
      expire = fire;
      timer.mock.restore();
      return watchdog;
    });
  return { expire: () => {
    assert.ok(expire, 'The process did not schedule its timeout');
    expire();
  } };
}

export async function within<T>(promise: Promise<T>, message: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([promise, new Promise<never>((_, reject) => {
      timer = realSetTimeout(() => reject(new Error(message)), startupLimitMs);
    })]);
  } finally {
    clearTimeout(timer);
  }
}

async function readPid(file: string): Promise<number | undefined> {
  try {
    const text = (await readFile(file, 'utf8')).trim();
    if (!text) return undefined; // A readiness file can be observed while it is being written.
    const pid = Number(text);
    assert.ok(Number.isSafeInteger(pid) && pid > 1, `Invalid test process PID in ${file}`);
    return pid;
  } catch (error: unknown) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return undefined;
    throw error;
  }
}

export function isRunning(pid: number): boolean {
  try { process.kill(pid, 0); return true; } catch (error: unknown) {
    if (error instanceof Error && 'code' in error && error.code === 'ESRCH') return false;
    throw error;
  }
}

export async function waitForPid(file: string): Promise<number> {
  const deadline = performance.now() + startupLimitMs;
  while (performance.now() < deadline) {
    const pid = await readPid(file);
    if (pid !== undefined) return pid;
    await pause(20);
  }
  throw new Error(`Process did not become ready: ${file}`);
}

export async function assertStopped(pids: number[]): Promise<void> {
  const deadline = performance.now() + 3_000;
  while (pids.some(isRunning) && performance.now() < deadline) await pause(20);
  assert.deepEqual(pids.filter(isRunning), [], 'Test descendants survived process cleanup');
}

/** Called in finally even when readiness or an assertion fails. */
export async function cleanupProcesses(pidFiles: string[]): Promise<void> {
  for (const file of pidFiles) {
    const pid = await readPid(file);
    if (pid === undefined) continue;
    for (const target of [-pid, pid]) {
      try { process.kill(target, 'SIGKILL'); } catch (error: unknown) {
        if (!(error instanceof Error && 'code' in error && error.code === 'ESRCH')) throw error;
      }
    }
  }
}
