import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { test, type TestContext } from "node:test";
import { digest, readJson, readRecords } from "../src/json.js";
import { evaluate } from "../src/evaluate.js";
import { parseCases, type Case } from "../src/schema.js";
import { prepare, runPlan, requestSchema, type RunnerPlan } from "../src/runner.js";
import { runProcess } from "../src/process.js";

const ADAPTER = `
const fs = require('node:fs');
const req = JSON.parse(fs.readFileSync(0, 'utf8'));
if ('expected' in req || 'sources' in req) throw new Error('Gold leaked');
for (const paths of Object.values(req.context)) {
  for (const name of paths) if (!fs.statSync(name).isFile()) throw new Error('Missing context');
}
console.log(JSON.stringify({action:'answer',facts:{toy_result:7},
 answer_text:'Synthetic adapter output, not model performance.',citations:req.context.sources}));
`;

async function fixture(t: TestContext) {
  const root = await mkdtemp(path.join(os.tmpdir(), "grad-eval-runner-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const context = path.join(root, "public-context");
  await mkdir(context);
  for (const name of ["source.md", "wiki.md", "skill.md"]) {
    await writeFile(path.join(context, name), `INVENTED CONTENT ONLY: ${name}`);
  }
  const cases: Case[] = parseCases([{
    id: "toy", family: "toy-rule", split: "dev", origin: "synthetic", review_status: "draft",
    oracle_reviewer: null, independent_reference: false,
    question: "INVENTED task: return toy_result as a number.", inputs: { toy_given: 7 },
    expected: { action: "answer", facts: { toy_result: 7 } },
    sources: [{ id: "toy-source", version: "invented", locator: "GOLD-LOCATION-SECRET",
      excerpt: "GOLD-EXCERPT-SECRET", authoritative: false }],
  }]);
  const config = {
    context_root: context, sources: ["source.md"], wiki: ["wiki.md"], skills: ["skill.md"],
    conditions: ["A", "B", "C"], model: "synthetic-adapter", model_config: "fixture-v1",
    prompt: "p1", code: "none", data: "none", tools: "none", runtime: "node-test", timeout: 5,
  };
  const out = path.join(root, "prepared");
  const execute = (code = ADAPTER, directory = out) => runPlan(path.join(directory, "plan.json"), [process.execPath, "-e", code]);
  return { root, context, cases, config, out, execute };
}

async function rewritePlan(out: string, plan: RunnerPlan): Promise<void> {
  const { plan_sha256: _checksum, ...unsigned } = plan;
  await writeFile(path.join(out, "plan.json"), JSON.stringify({ ...unsigned, plan_sha256: digest(unsigned) }));
}

test("prepare exposes only task inputs and condition-specific documents", async (t) => {
  const f = await fixture(t);
  const plan = await prepare(f.cases, f.config, f.out);
  assert.equal(plan.execution, "synthetic");
  assert.equal(plan.jobs.length, 3);
  for (const job of plan.jobs) {
    const file = path.join(f.out, "jobs", job.job_id, "request.json");
    const text = await readFile(file, "utf8");
    const request = requestSchema.parse(await readJson(file));
    assert(!text.includes("GOLD-"));
    assert(!Object.hasOwn(request, "expected"));
    assert(!Object.hasOwn(request, "review_status"));
    assert.equal(request.context.wiki.length > 0, job.condition !== "A");
    assert.equal(request.context.skills.length > 0, job.condition === "C");
    assert.deepEqual(request.inputs, { toy_given: 7 });
  }
});

test("nested gold-like input keys are rejected before creating output", async (t) => {
  const f = await fixture(t);
  const item = f.cases[0];
  assert(item);
  item.inputs = { payload: [{ oracle: "secret" }] };
  await assert.rejects(prepare(f.cases, f.config, f.out), /oracle key/);
  await assert.rejects(readFile(path.join(f.out, "plan.json")), /ENOENT/);
});

test("allowlist rejects sensitive paths, globs, directories and symlink escape", async (t) => {
  const f = await fixture(t);
  await writeFile(path.join(f.context, ".env"), "dummy placeholder");
  await mkdir(path.join(f.context, "students"));
  await writeFile(path.join(f.context, "students", "toy.json"), "{}");
  await writeFile(path.join(f.root, "outside.md"), "outside");
  await symlink(path.join(f.root, "outside.md"), path.join(f.context, "escape.md"));
  for (const source of [".env", "students/toy.json", "students", "*.md", "../outside.md", "escape.md"]) {
    await assert.rejects(prepare(f.cases, { ...f.config, sources: [source] }, f.out));
  }
});

test("missing context and existing output directory are rejected", async (t) => {
  const f = await fixture(t);
  await assert.rejects(prepare(f.cases, { ...f.config, wiki: [] }, f.out), /WIKI/);
  await assert.rejects(prepare(f.cases, { ...f.config, skills: [] }, f.out), /Skill/);
  await mkdir(f.out);
  await assert.rejects(prepare(f.cases, f.config, f.out), /already exists/);
});

test("run persists every result with elapsed time, unknown usage and synthetic label", async (t) => {
  const f = await fixture(t);
  const plan = await prepare(f.cases, f.config, f.out);
  const records = await f.execute();
  assert.equal(records.length, 3);
  for (const record of records) {
    assert(record.status === "ok");
    assert.equal(record.execution, "synthetic");
    assert(record.elapsed_ms !== null && record.elapsed_ms !== undefined && record.elapsed_ms > 0);
    assert.equal(record.input_tokens, null);
    assert.equal(record.output_tokens, null);
    assert.equal(record.output_sha256, digest(record.output));
    assert.equal(record.plan_sha256, plan.plan_sha256);
    assert.equal(digest(await readJson(path.join(f.out, "jobs", record.run_id, "result.json"))), digest(record));
  }
  const report = evaluate(f.cases, records, [], plan.evaluation_plan);
  assert.deepEqual(new Set(Object.values(report.gates).map((gate) => gate.gate)), new Set(["INCONCLUSIVE"]));
});

test("common instructions and planned order are frozen", async (t) => {
  const f = await fixture(t);
  const config = { ...f.config, instructions: "Use toy_result only.", repeats: 2 };
  const first = await prepare(f.cases, config, f.out);
  assert.deepEqual(first.jobs.map((job) => job.condition), ["A", "B", "C", "A", "B", "C"]);
  for (const job of first.jobs) {
    const request = requestSchema.parse(await readJson(path.join(f.out, "jobs", job.job_id, "request.json")));
    assert.equal(request.instructions, config.instructions);
  }
  const second = await prepare(f.cases, { ...config, instructions: "Changed common format" }, path.join(f.root, "other"));
  assert.notEqual(first.metadata.prompt, second.metadata.prompt);
});

test("request whitespace is preserved across snapshot hashing and validation", async (t) => {
  const f = await fixture(t);
  const item = f.cases[0];
  assert(item);
  item.id = " toy-with-spaces ";
  item.question = "  Keep the exact question, including its whitespace.\n";
  await prepare(f.cases, { ...f.config, conditions: ["A"] }, f.out);
  const request = requestSchema.parse(await readJson(path.join(f.out, "jobs/A-0001-001/request.json")));
  assert.equal(request.case_id, item.id);
  assert.equal(request.question, item.question);
  assert.equal((await f.execute())[0]?.status, "ok");
});

test("mutating original source after prepare cannot change the copied context", async (t) => {
  const f = await fixture(t);
  await prepare(f.cases, f.config, f.out);
  await writeFile(path.join(f.context, "source.md"), "changed original");
  assert.equal((await f.execute())[0]?.status, "ok");
  assert.match(await readFile(path.join(f.out, "jobs/A-0001-001/context/sources/source.md"), "utf8"), /INVENTED/);
});

test("changed plan, request, context or extra files are rejected before starting", async (t) => {
  const f = await fixture(t);
  for (const changed of ["plan", "request", "context", "extra"]) {
    const out = path.join(f.root, changed);
    const plan = await prepare(f.cases, f.config, out);
    const job = path.join(out, "jobs/A-0001-001");
    if (changed === "plan") await writeFile(path.join(out, "plan.json"), JSON.stringify({ ...plan, execution: "real" }));
    if (changed === "request") await writeFile(path.join(job, "request.json"), "{}");
    if (changed === "context") await writeFile(path.join(job, "context/sources/source.md"), "different");
    if (changed === "extra") await writeFile(path.join(job, "gold.txt"), "unexpected");
    await assert.rejects(f.execute(ADAPTER, out));
    await assert.rejects(readFile(path.join(out, "started.json")), /ENOENT/);
  }
});

test("recomputed checksum cannot silently drop a planned job", async (t) => {
  const f = await fixture(t);
  const plan = await prepare(f.cases, f.config, f.out);
  plan.jobs.pop();
  await rewritePlan(f.out, plan);
  await assert.rejects(f.execute(), /missing jobs/);
});

test("reexecution is blocked and existing results are preserved", async (t) => {
  const f = await fixture(t);
  await prepare(f.cases, f.config, f.out);
  await f.execute();
  const original = await readFile(path.join(f.out, "runs.jsonl"), "utf8");
  await assert.rejects(f.execute(), /already started/);
  assert.equal(await readFile(path.join(f.out, "runs.jsonl"), "utf8"), original);
});

test("timeout is a recorded error, not an implicit retry", async (t) => {
  const f = await fixture(t);
  await prepare(f.cases, { ...f.config, conditions: ["A"], timeout: 0.05 }, f.out);
  const records = await f.execute("setTimeout(() => {}, 3000)");
  assert.equal(records.length, 1);
  const record = records[0];
  assert(record?.status === "error");
  assert.equal(record.error, "adapter_timeout");
});

test("timeout and successful parent exit clean up ordinary grandchildren", async (t) => {
  const f = await fixture(t);
  for (const parentExits of [false, true]) {
    const marker = path.join(f.root, `survived-${parentExits}`);
    const child = `setTimeout(()=>require('node:fs').writeFileSync(${JSON.stringify(marker)},'alive'),350)`;
    const code = `require('node:child_process').spawn(process.execPath,['-e',${JSON.stringify(child)}],{stdio:'inherit'});` +
      (parentExits ? "process.exit(0)" : "setTimeout(()=>{},3000)");
    const result = await runProcess([process.execPath, "-e", code], { cwd: f.root, input: "", timeoutMs: parentExits ? 2000 : 150 });
    assert.equal(result.timedOut, !parentExits);
    await delay(450);
    await assert.rejects(readFile(marker), /ENOENT/);
  }
});

test("outer timeout cleans nested SIGTERM-ignoring children before killing their adapter", async (t) => {
  const f = await fixture(t);
  const started = path.join(f.root, "nested-started");
  const survived = path.join(f.root, "nested-survived");
  const interrupted = path.join(f.root, "nested-interrupted");
  const descendant = `process.on('SIGTERM',()=>{});require('node:fs').writeFileSync(${JSON.stringify(started)},'ready');` +
    `setTimeout(()=>require('node:fs').writeFileSync(${JSON.stringify(survived)},'alive'),1800);`;
  const nestedChild = `process.on('SIGTERM',()=>{});require('node:child_process').spawn(process.execPath,['-e',${JSON.stringify(descendant)}],{stdio:'inherit'});` +
    "setTimeout(()=>{},10000);";
  const module = new URL("../src/process.ts", import.meta.url).href;
  const adapter = `
    import { writeFileSync } from 'node:fs';
    import { runProcess, ProcessInterruptedError } from ${JSON.stringify(module)};
    try {
      await runProcess([process.execPath,'-e',${JSON.stringify(nestedChild)}],
        {cwd:process.cwd(),input:'',timeoutMs:10000,forwardSignals:true});
    } catch (error) {
      if (!(error instanceof ProcessInterruptedError)) throw error;
      writeFileSync(${JSON.stringify(interrupted)}, JSON.stringify({signal:error.signal,
        listeners:process.listenerCount('SIGTERM')}));
    }
  `;
  const result = await runProcess([process.execPath, "--import", import.meta.resolve("tsx"),
    "--input-type=module", "-e", adapter], { cwd: f.root, input: "", timeoutMs: 1000 });
  assert.equal(result.timedOut, true);
  assert.equal(await readFile(started, "utf8"), "ready");
  assert.equal(digest(await readJson(interrupted)), digest({ signal: "SIGTERM", listeners: 0 }));
  await delay(1100);
  await assert.rejects(readFile(survived), /ENOENT/);
});

test("timeout escalates when a process ignores SIGTERM", async (t) => {
  const f = await fixture(t);
  const ready = path.join(f.root, "ignores-term");
  const code = `process.on('SIGTERM',()=>{});require('node:fs').writeFileSync(${JSON.stringify(ready)},'ready');setInterval(()=>{},1000);`;
  const result = await runProcess([process.execPath, "-e", code],
    { cwd: f.root, input: "", timeoutMs: 150 });
  assert.equal(await readFile(ready, "utf8"), "ready");
  assert.equal(result.timedOut, true);
  assert.equal(result.signal, "SIGKILL");
});

test("interrupting runPlan stops its nested child and does not start the next job", async (t) => {
  const f = await fixture(t);
  await prepare(f.cases, { ...f.config, timeout: 10 }, f.out);
  const started = path.join(f.root, "interrupt-child-ready");
  const survived = path.join(f.root, "interrupt-child-survived");
  const supervisorPid = path.join(f.root, "supervisor-pid");
  const stopped = path.join(f.root, "supervisor-stopped");
  const child = `process.on('SIGTERM',()=>{});require('node:fs').writeFileSync(${JSON.stringify(started)},'ready');` +
    `setTimeout(()=>require('node:fs').writeFileSync(${JSON.stringify(survived)},'alive'),1800);`;
  const processModule = new URL("../src/process.ts", import.meta.url).href;
  const runnerModule = new URL("../src/runner.ts", import.meta.url).href;
  const adapter = `import {runProcess} from ${JSON.stringify(processModule)};
    await runProcess([process.execPath,'-e',${JSON.stringify(child)}],
      {cwd:process.cwd(),input:'',timeoutMs:10000,forwardSignals:true});`;
  const adapterCommand = [process.execPath, "--import", import.meta.resolve("tsx"), "--input-type=module", "-e", adapter];
  const supervisor = `import {writeFileSync} from 'node:fs';
    import {runPlan} from ${JSON.stringify(runnerModule)};
    import {ProcessInterruptedError} from ${JSON.stringify(processModule)};
    writeFileSync(${JSON.stringify(supervisorPid)}, String(process.pid));
    try { await runPlan(${JSON.stringify(path.join(f.out, "plan.json"))}, ${JSON.stringify(adapterCommand)}); }
    catch(error) {
      if (!(error instanceof ProcessInterruptedError)) throw error;
      writeFileSync(${JSON.stringify(stopped)},error.signal);
    }`;
  const execution = runProcess([process.execPath, "--import", import.meta.resolve("tsx"),
    "--input-type=module", "-e", supervisor], { cwd: f.root, input: "", timeoutMs: 5000 });
  for (let attempt = 0; attempt < 150; attempt += 1) {
    try { await readFile(started); break; } catch { await delay(20); }
  }
  assert.equal(await readFile(started, "utf8"), "ready");
  process.kill(Number(await readFile(supervisorPid, "utf8")), "SIGINT");
  const result = await execution;
  assert.equal(result.timedOut, false);
  assert.equal(result.exitCode, 0);
  assert.equal(await readFile(stopped, "utf8"), "SIGINT");
  assert.equal((await readRecords(path.join(f.out, "runs.jsonl"))).length, 0);
  await assert.rejects(readFile(path.join(f.out, "jobs/B-0001-001/result.json")), /ENOENT/);
  await delay(1900);
  await assert.rejects(readFile(survived), /ENOENT/);
});

test("invalid output and nonzero exits preserve per-job errors", async (t) => {
  const f = await fixture(t);
  const programs = ["process.exit(3)", "console.log('not json')", "console.log('{}')",
    `console.log('{"action":"answer","action":"clarify"}')`,
    `console.log(JSON.stringify({action:'answer',facts:{},answer_text:'',citations:[]}))`];
  for (const [index, code] of programs.entries()) {
    const out = path.join(f.root, `invalid-${index}`);
    await prepare(f.cases, { ...f.config, conditions: ["A"] }, out);
    const result = (await f.execute(code, out))[0];
    assert(result?.status === "error");
    assert(!Object.hasOwn(result, "output_sha256"));
  }
});

test("arguments are passed without a shell and affect the adapter fingerprint", async (t) => {
  const f = await fixture(t);
  await prepare(f.cases, { ...f.config, conditions: ["A"] }, f.out);
  const code = `if(process.argv[1]!=='; touch SHOULD_NOT_EXIST'||process.argv[2]!=='')throw Error('wrong argv');${ADAPTER}`;
  const records = await runPlan(path.join(f.out, "plan.json"), [process.execPath, "-e", code, "; touch SHOULD_NOT_EXIST", ""]);
  assert.equal(records[0]?.status, "ok");
  await assert.rejects(readFile(path.join(f.out, "jobs/A-0001-001/SHOULD_NOT_EXIST")), /ENOENT/);
  const other = path.join(f.root, "other");
  await prepare(f.cases, { ...f.config, conditions: ["A"] }, other);
  const second = await f.execute(ADAPTER, other);
  assert.notEqual(records[0]?.versions.adapter, second[0]?.versions.adapter);
});

test("cross-job mutation aborts before evaluating the changed request", async (t) => {
  const f = await fixture(t);
  await prepare(f.cases, f.config, f.out);
  const code = `require('node:fs').writeFileSync('../B-0001-001/request.json','{}');${ADAPTER}`;
  await assert.rejects(f.execute(code));
  assert.equal((await readRecords(path.join(f.out, "runs.jsonl"))).length, 1);
  await assert.rejects(readFile(path.join(f.out, "jobs/B-0001-001/result.json")), /ENOENT/);
});

test("process output is bounded and spawn failures are reported", async (t) => {
  const f = await fixture(t);
  const result = await runProcess([process.execPath, "-e", "process.stdout.write('x'.repeat(1000000));setTimeout(()=>{},5000)"],
    { cwd: f.root, input: "", timeoutMs: 2000, maxOutputBytes: 1024 });
  assert.equal(result.outputLimitExceeded, true);
  assert(Buffer.byteLength(result.stdout) + Buffer.byteLength(result.stderr) <= 1024);
  await assert.rejects(runProcess([path.join(f.root, "missing-executable")], { cwd: f.root, input: "", timeoutMs: 500 }));
});

test("oversized timeout is rejected before Node can shorten it to one millisecond", async (t) => {
  const f = await fixture(t);
  await assert.rejects(prepare(f.cases, { ...f.config, timeout: 2_147_484 }, f.out));
  await assert.rejects(readFile(path.join(f.out, "plan.json")), /ENOENT/);
  await assert.rejects(runProcess([process.execPath, "-e", ADAPTER],
    { cwd: f.root, input: "", timeoutMs: 2_147_483_648 }), /timeout/);
});
