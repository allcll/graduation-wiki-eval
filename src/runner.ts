import { createHash } from "node:crypto";
import {
  access,
  lstat,
  mkdir,
  open,
  readFile,
  readdir,
  realpath,
  stat,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { z } from "zod";
import { digest, parseJson, readJson } from "./json.js";
import { makePlan } from "./evaluate.js";
import {
  HARNESS_VERSION,
  outputSchema,
  parseCases,
  planSchema,
  runSchema,
  type Case,
  type JsonValue,
  type Run,
} from "./schema.js";
import { MAX_TIMEOUT_MS, ProcessInterruptedError, runProcess, TERMINATION_GRACE_MS } from "./process.js";

const RUNNER_SCHEMA = "graduation-wiki-eval/runner-v3";
export const CONTEXT_GROUPS = ["sources", "wiki", "skills"] as const;
type ContextGroup = (typeof CONTEXT_GROUPS)[number];
const blockedParts = new Set([
  ".git", ".aws", ".ssh", "private", "private_data", "private-data", "student",
  "students", "student_data", "student-data", "student_records", "student-records",
  "pii", "secrets", "credentials", "datasets",
]);
const goldKeys = new Set([
  "expected", "expected_answer", "expected_facts", "expected_action", "gold",
  "gold_answer", "ground_truth", "oracle", "oracle_reviewer", "review", "reviews",
  "review_status", "sources", "source_excerpt", "source_excerpts", "answer_key", "answer_keys",
  "rubric", "rubric_sha256", "criteria", "criterion_results", "review_guide",
]);

export class RunnerError extends Error {
  override name = "RunnerError";
}

function requireCondition(ok: unknown, message: string): asserts ok {
  if (!ok) throw new RunnerError(message);
}

function relativeParts(value: string): string[] {
  const parts = value.split("/");
  requireCondition(
    value.trim() && !path.posix.isAbsolute(value) && !value.includes("\\") &&
      !parts.some((part) => part === "" || part === "." || part === ".."),
    "Path must stay below its allowlisted root",
  );
  requireCondition(!/[*?\[\]]/.test(value), "Globs are not accepted; list each file explicitly");
  return parts;
}

const relativePathSchema = z.string().min(1).refine((value) => {
  try { relativeParts(value); return true; } catch { return false; }
}, "Expected an explicit relative file path");
const strings = z.array(relativePathSchema).refine((values) => new Set(values).size === values.length, "Duplicate file paths");
const nonempty = z.string().refine((value) => value.trim().length > 0, "Expected nonempty text");
const metadataSchema = z.object({
  model: nonempty,
  model_config: nonempty,
  prompt: nonempty,
  code: nonempty,
  data: nonempty,
  tools: nonempty,
  runtime: nonempty,
}).strict();
const configSchema = metadataSchema.extend({
  context_root: nonempty,
  sources: strings.min(1),
  wiki: strings.default([]),
  skills: strings.default([]),
  conditions: z.array(z.enum(["A", "B", "C"])).min(1).default(["A", "B", "C"]),
  repeats: z.number().int().positive().default(1),
  timeout: z.number().finite().positive().max(MAX_TIMEOUT_MS / 1000).default(60),
  execution: z.enum(["real", "synthetic"]).default("synthetic"),
  instructions: z.string().default(""),
}).strict();

export const OUTPUT_CONTRACT = {
  action: ["answer", "clarify", "escalate"] satisfies Array<"answer" | "clarify" | "escalate">,
  facts: "JSON object of task facts; field names must be specified by the task prompt",
  answer_text: "string: complete user-facing answer, including uncertainty",
  citations: "array of strings identifying supporting context paths or source locations",
};
const outputContractSchema = z.object({
  action: z.array(z.enum(["answer", "clarify", "escalate"])),
  facts: z.string(),
  answer_text: z.string(),
  citations: z.string(),
}).strict();
const contextSchema = z.object({ sources: strings, wiki: strings, skills: strings }).strict();
export const requestSchema = z.object({
  job_id: nonempty,
  case_id: nonempty,
  condition: z.enum(["A", "B", "C"]),
  question: nonempty,
  inputs: z.record(z.string(), z.json()),
  context: contextSchema,
  instructions: z.string(),
  output_contract: outputContractSchema,
}).strict();
export type RunnerRequest = z.infer<typeof requestSchema>;

const fileSchema = z.object({
  path: relativePathSchema,
  sha256: z.string().regex(/^sha256:[0-9a-f]{64}$/),
  bytes: z.number().int().nonnegative(),
}).strict();
type SnapshotFile = z.infer<typeof fileSchema>;
const manifestSchema = z.object({
  sources: z.array(fileSchema),
  wiki: z.array(fileSchema),
  skills: z.array(fileSchema),
}).strict();
const jobSchema = z.object({
  job_id: relativePathSchema.refine((value) => !value.includes("/"), "Job ID must be one path segment"),
  case_id: nonempty,
  condition: z.enum(["A", "B", "C"]),
  repeat: z.number().int().positive(),
  case_sha256: nonempty,
  request_sha256: nonempty,
  files: z.array(fileSchema),
}).strict();
type Job = z.infer<typeof jobSchema>;
const promptSnapshotSchema = z.object({
  declared: nonempty,
  instructions: z.string(),
  output_contract: outputContractSchema,
}).strict();
export const runnerPlanSchema = z.object({
  schema: z.literal(RUNNER_SCHEMA),
  created_at: nonempty,
  execution: z.enum(["real", "synthetic"]),
  timeout: z.number().finite().positive().max(MAX_TIMEOUT_MS / 1000),
  metadata: metadataSchema,
  prompt_snapshot: promptSnapshotSchema,
  evaluation_plan: planSchema,
  context_manifest: manifestSchema,
  jobs: z.array(jobSchema),
  warning: z.string(),
  plan_sha256: nonempty,
}).strict();
export type RunnerPlan = z.infer<typeof runnerPlanSchema>;

function contentHash(value: Uint8Array): string {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function within(root: string, file: string): boolean {
  const relative = path.relative(root, file);
  return relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

async function exists(file: string): Promise<boolean> {
  try { await access(file); return true; } catch (error: unknown) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return false;
    throw error;
  }
}

async function safeSource(root: string, relative: string): Promise<string> {
  const parts = relativeParts(relative);
  const resolved = await realpath(path.join(root, ...parts));
  requireCondition(within(root, resolved), `Source symlink escapes context_root: ${relative}`);
  for (const part of [...parts, ...path.relative(root, resolved).split(path.sep)]) {
    const lower = part.toLowerCase();
    requireCondition(!blockedParts.has(lower) && !lower.startsWith(".env"), `Sensitive/private source path rejected: ${relative}`);
  }
  requireCondition((await stat(resolved)).isFile(), `Only explicit files are allowed: ${relative}`);
  return resolved;
}

function safeInputs(value: JsonValue): void {
  if (Array.isArray(value)) {
    value.forEach(safeInputs);
  } else if (value !== null && typeof value === "object") {
    for (const [key, child] of Object.entries(value)) {
      requireCondition(!goldKeys.has(key.toLowerCase().replaceAll("-", "_")), `Evaluation/oracle key is not allowed in task inputs: ${key}`);
      safeInputs(child);
    }
  }
}

async function writeNew(file: string, value: unknown): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, `${JSON.stringify(value, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
}

/** Freeze explicit files and task requests; this does not create a security sandbox. */
export async function prepare(cases: Case[], input: unknown, outdir: string): Promise<RunnerPlan> {
  const checkedCases = parseCases(cases);
  const config = configSchema.parse(input);
  const evaluationPlan = makePlan(checkedCases, config.conditions, config.repeats);
  const root = await realpath(path.resolve(config.context_root));
  requireCondition((await stat(root)).isDirectory(), "context_root must be a directory");
  const snapshots: Record<ContextGroup, Map<string, Buffer>> = {
    sources: new Map(), wiki: new Map(), skills: new Map(),
  };
  const manifests: Record<ContextGroup, SnapshotFile[]> = { sources: [], wiki: [], skills: [] };
  for (const group of CONTEXT_GROUPS) {
    for (const relative of [...config[group]].sort()) {
      const content = await readFile(await safeSource(root, relative));
      snapshots[group].set(relative, content);
      manifests[group].push({ path: relative, sha256: contentHash(content), bytes: content.byteLength });
    }
  }
  requireCondition(!config.conditions.some((c) => c === "B" || c === "C") || manifests.wiki.length, "B/C require an explicit WIKI snapshot");
  requireCondition(!config.conditions.includes("C") || manifests.skills.length, "C requires an explicit Skill snapshot");
  const jobs: Job[] = [];
  const requests = new Map<string, RunnerRequest>();
  for (const [index, item] of checkedCases.entries()) {
    const inputs = item.inputs ?? {};
    safeInputs(inputs);
    for (let repeat = 1; repeat <= config.repeats; repeat += 1) {
      for (const condition of config.conditions) {
        const groups: ContextGroup[] = ["sources"];
        if (condition !== "A") groups.push("wiki");
        if (condition === "C") groups.push("skills");
        const jobId = `${condition}-${String(index + 1).padStart(4, "0")}-${String(repeat).padStart(3, "0")}`;
        const context: Record<ContextGroup, string[]> = { sources: [], wiki: [], skills: [] };
        const files: SnapshotFile[] = [];
        for (const group of groups) {
          for (const file of manifests[group]) {
            const relative = `context/${group}/${file.path}`;
            context[group].push(relative);
            files.push({ ...file, path: relative });
          }
        }
        const request: RunnerRequest = {
          job_id: jobId, case_id: item.id, condition, question: item.question,
          inputs, context, instructions: config.instructions, output_contract: OUTPUT_CONTRACT,
        };
        requests.set(jobId, request);
        jobs.push({ job_id: jobId, case_id: item.id, condition, repeat,
          case_sha256: digest(item), request_sha256: digest(request), files });
      }
    }
  }
  const promptSnapshot = { declared: config.prompt, instructions: config.instructions, output_contract: OUTPUT_CONTRACT };
  const unsigned = {
    schema: RUNNER_SCHEMA, created_at: new Date().toISOString(), execution: config.execution, timeout: config.timeout,
    metadata: { model: config.model, model_config: config.model_config, prompt: digest(promptSnapshot),
      code: config.code, data: config.data, tools: config.tools, runtime: config.runtime },
    prompt_snapshot: promptSnapshot, evaluation_plan: evaluationPlan, context_manifest: manifests, jobs,
    warning: "Trusted adapter, inherited environment; NOT an OS sandbox or credential boundary.",
  };
  const plan = runnerPlanSchema.parse({ ...unsigned, plan_sha256: digest(unsigned) });
  const destination = path.resolve(outdir);
  requireCondition(!(await exists(destination)), "Output directory already exists; prepare requires a fresh directory");
  await mkdir(path.dirname(destination), { recursive: true });
  await mkdir(destination);
  for (const job of jobs) {
    const directory = path.join(destination, "jobs", job.job_id);
    await writeNew(path.join(directory, "request.json"), requests.get(job.job_id));
    for (const file of job.files) {
      const parts = file.path.split("/");
      const group = CONTEXT_GROUPS.find((candidate) => candidate === parts[1]);
      requireCondition(group, "Invalid context group");
      const content = snapshots[group].get(parts.slice(2).join("/"));
      requireCondition(content, "Missing prepared snapshot");
      const target = path.join(directory, ...parts);
      await mkdir(path.dirname(target), { recursive: true });
      await writeFile(target, content, { flag: "wx" });
    }
  }
  await writeNew(path.join(destination, "plan.json"), plan);
  return plan;
}

async function localFile(root: string, relative: string): Promise<string> {
  const parts = relativeParts(relative);
  let current = root;
  for (const part of parts) {
    current = path.join(current, part);
    requireCondition(!(await lstat(current)).isSymbolicLink(), `Snapshot symlinks are not allowed: ${relative}`);
  }
  requireCondition((await stat(current)).isFile() && within(root, await realpath(current)), `Missing/escaped snapshot file: ${relative}`);
  return current;
}

async function actualFiles(directory: string, prefix = ""): Promise<string[]> {
  const result: string[] = [];
  for (const entry of await readdir(path.join(directory, prefix), { withFileTypes: true })) {
    const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) result.push(...await actualFiles(directory, relative));
    else result.push(relative);
  }
  return result;
}

async function validateJob(job: Job, root: string): Promise<void> {
  const directory = path.join(root, "jobs", job.job_id);
  const requestFile = await localFile(root, `jobs/${job.job_id}/request.json`);
  const request = requestSchema.parse(await readJson(requestFile));
  requireCondition(digest(request) === job.request_sha256, `Request snapshot changed: ${job.job_id}`);
  requireCondition(request.job_id === job.job_id && request.case_id === job.case_id && request.condition === job.condition, "Request identity differs from its planned job");
  const allowed = new Set(["request.json"]);
  for (const file of job.files) {
    requireCondition(!allowed.has(file.path), "Duplicate snapshot file");
    const content = await readFile(await localFile(root, `jobs/${job.job_id}/${file.path}`));
    requireCondition(contentHash(content) === file.sha256 && content.byteLength === file.bytes, `Context snapshot changed: ${file.path}`);
    allowed.add(file.path);
  }
  const actual = await actualFiles(directory);
  requireCondition(actual.length === allowed.size && actual.every((file) => allowed.has(file)), `Unexpected files in fresh job directory: ${job.job_id}`);
}

async function validateSnapshot(plan: RunnerPlan, root: string): Promise<void> {
  const { plan_sha256: checksum, ...unsigned } = plan;
  requireCondition(checksum === digest(unsigned), "Runner plan checksum mismatch");
  requireCondition(plan.metadata.prompt === digest(plan.prompt_snapshot), "Prompt metadata differs from its snapshot");
  requireCondition(new Set(plan.evaluation_plan.conditions).size === plan.evaluation_plan.conditions.length,
    "Evaluation plan has duplicate conditions");
  requireCondition(new Set(plan.evaluation_plan.cases.map((item) => item.case_id)).size === plan.evaluation_plan.cases.length,
    "Evaluation plan has duplicate cases");
  const expected = new Map<string, string>();
  for (const item of plan.evaluation_plan.cases) {
    for (const condition of plan.evaluation_plan.conditions) {
      for (let repeat = 1; repeat <= plan.evaluation_plan.repeats; repeat += 1) {
        expected.set(JSON.stringify([item.case_id, condition, repeat]), item.case_sha256);
      }
    }
  }
  const seen = new Set<string>();
  const ids = new Set<string>();
  for (const job of plan.jobs) {
    const key = JSON.stringify([job.case_id, job.condition, job.repeat]);
    requireCondition(!seen.has(key) && expected.get(key) === job.case_sha256, "Job grid differs from frozen evaluation plan");
    requireCondition(!ids.has(job.job_id), "Duplicate job id");
    seen.add(key);
    ids.add(job.job_id);
    const groups: ContextGroup[] = job.condition === "A" ? ["sources"] : job.condition === "B" ? ["sources", "wiki"] : [...CONTEXT_GROUPS];
    const expectedFiles = groups.flatMap((group) => plan.context_manifest[group].map((file) => ({ ...file, path: `context/${group}/${file.path}` })));
    requireCondition(digest(job.files) === digest(expectedFiles), "Job files differ from its condition's snapshot");
    const request = requestSchema.parse(await readJson(await localFile(root, `jobs/${job.job_id}/request.json`)));
    for (const group of CONTEXT_GROUPS) {
      const required = groups.includes(group) ? plan.context_manifest[group].map((file) => `context/${group}/${file.path}`) : [];
      requireCondition(digest(request.context[group]) === digest(required), "Request context differs from its condition");
    }
    requireCondition(request.instructions === plan.prompt_snapshot.instructions && digest(request.output_contract) === digest(plan.prompt_snapshot.output_contract), "Request instructions differ from shared prompt");
    await validateJob(job, root);
  }
  requireCondition(seen.size === expected.size, "Frozen plan is missing jobs");
}

/** Run each planned job once. The adapter is trusted and inherits the environment. */
export async function runPlan(planPath: string, command: readonly string[]): Promise<Run[]> {
  requireCondition(process.platform !== "win32", "Command execution requires POSIX process groups (macOS/Linux)");
  requireCondition(command[0] && command.every((value) => typeof value === "string"), "command must be a nonempty argv list");
  const adapterFiles: Record<string, string> = {};
  for (const arg of command) {
    if (path.isAbsolute(arg) && await exists(arg) && (await stat(arg)).isFile()) {
      adapterFiles[arg] = contentHash(await readFile(arg));
    }
  }
  const adapterHash = digest({ argv: [...command], files: adapterFiles });
  const filename = await realpath(planPath);
  const root = path.dirname(filename);
  const plan = runnerPlanSchema.parse(await readJson(filename));
  requireCondition(!(await exists(path.join(root, "runs.jsonl"))) && !(await exists(path.join(root, "started.json"))), "Plan already started; refusing overwrite or retry");
  await validateSnapshot(plan, root);
  await writeNew(path.join(root, "started.json"), { started_at: new Date().toISOString(), plan_sha256: plan.plan_sha256 });
  const records: Run[] = [];
  const stream = await open(path.join(root, "runs.jsonl"), "wx");
  try {
    for (const job of plan.jobs) {
      await validateJob(job, root);
      const directory = path.join(root, "jobs", job.job_id);
      const request = await readFile(path.join(directory, "request.json"), "utf8");
      const versions = {
        ...plan.metadata, adapter: adapterHash, harness: HARNESS_VERSION,
        dataset: plan.evaluation_plan.dataset_sha256, source: digest(plan.context_manifest.sources),
        wiki: job.condition === "A" ? "none" : digest(plan.context_manifest.wiki),
        skill: job.condition === "C" ? digest(plan.context_manifest.skills) : "none",
      };
      const base = {
        run_id: job.job_id, case_id: job.case_id, condition: job.condition, repeat: job.repeat,
        case_sha256: job.case_sha256, versions, execution: plan.execution,
        started_at: new Date().toISOString(), input_tokens: null, output_tokens: null,
        plan_sha256: plan.plan_sha256,
      };
      const start = performance.now();
      let stdout = "";
      let stderr = "";
      let result: { status: "ok"; output: z.infer<typeof outputSchema>; output_sha256: string } | { status: "error"; error: string };
      try {
        const completed = await runProcess(command, {
          cwd: directory, input: request, timeoutMs: plan.timeout * 1000,
          forwardSignals: true, signalGraceMs: TERMINATION_GRACE_MS,
        });
        stdout = completed.stdout;
        stderr = completed.stderr;
        requireCondition(!completed.timedOut, "adapter_timeout");
        requireCondition(!completed.outputLimitExceeded, "adapter_output_limit");
        requireCondition(completed.exitCode === 0, `adapter_exit_${completed.exitCode ?? completed.signal ?? "unknown"}`);
        const output = outputSchema.parse(parseJson(stdout));
        requireCondition(Array.isArray(output.citations), "Adapter citations must be a string array");
        result = { status: "ok", output, output_sha256: digest(output) };
      } catch (error: unknown) {
        if (error instanceof ProcessInterruptedError) throw error;
        result = { status: "error", error: error instanceof Error ? error.message : "Unknown adapter failure" };
      }
      const record = runSchema.parse({ ...base, ...result, elapsed_ms: Math.round((performance.now() - start) * 1000) / 1000 });
      await writeFile(path.join(directory, "stdout.txt"), stdout, { encoding: "utf8", flag: "wx" });
      await writeFile(path.join(directory, "stderr.txt"), stderr, { encoding: "utf8", flag: "wx" });
      await writeNew(path.join(directory, "result.json"), record);
      await stream.write(`${JSON.stringify(record)}\n`);
      await stream.sync();
      records.push(record);
    }
  } finally {
    await stream.close();
  }
  return records;
}
