import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test, type TestContext } from "node:test";
import { digest, readJson, readRecords } from "../src/json.js";
import { evaluate } from "../src/evaluate.js";
import { parseCases, type Case } from "../src/schema.js";
import { prepare, runPlan, requestSchema, type RunnerPlan } from "../src/runner.js";
import { runProcess } from "../src/process.js";
import { assertStopped, cleanupProcesses, controlledDeadline, isRunning, waitForPid, within } from "./helpers/processes.js";

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
    rubric: { version: "toy-v1", criteria: [
      { id: "answer", dimension: "answer", severity: "major", description: "Explain the toy result." },
      { id: "source", dimension: "evidence", severity: "major", description: "Use the toy source." },
    ] },
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
    assert(!Object.hasOwn(request, "rubric"));
    assert(!Object.hasOwn(request, "criterion_results"));
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
  for (const key of ['rubric', 'criterion_results', 'rubric_sha256', 'review_guide']) {
    item.inputs = { payload: [{ [key]: 'reviewer-only' }] };
    await assert.rejects(prepare(f.cases, f.config, f.out), /oracle key/);
  }
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
    const parentPid = path.join(f.root, `parent-${parentExits}`);
    const childPid = path.join(f.root, `child-${parentExits}`);
    const child = `require('node:fs').writeFileSync(${JSON.stringify(childPid)},String(process.pid));` +
      "process.send('ready');setInterval(()=>{},1000);";
    const code = `require('node:fs').writeFileSync(${JSON.stringify(parentPid)},String(process.pid));` +
      `const child=require('node:child_process').spawn(process.execPath,['-e',${JSON.stringify(child)}],{stdio:['ignore','inherit','inherit','ipc']});` +
      (parentExits ? "child.once('message',()=>process.exit(0));" : "setInterval(()=>{},1000);");
    const deadline = controlledDeadline(t, 150);
    const execution = runProcess([process.execPath, "-e", code], { cwd: f.root, input: "", timeoutMs: 150 });
    try {
      const pid = await waitForPid(childPid);
      if (!parentExits) {
        assert.ok(isRunning(pid));
        deadline.expire();
      }
      const result = await within(execution, 'Parent process did not finish');
      assert.equal(result.timedOut, !parentExits);
      if (parentExits) assert.equal(result.exitCode, 0);
      await assertStopped([pid, await waitForPid(parentPid)]);
    } finally {
      deadline.expire();
      await cleanupProcesses([parentPid, childPid]);
      await within(execution, 'Process cleanup did not finish');
    }
  }
});

test("outer timeout cleans nested SIGTERM-ignoring children before killing their adapter", async (t) => {
  const f = await fixture(t);
  const adapterPid = path.join(f.root, "nested-adapter-pid");
  const parentPid = path.join(f.root, "nested-parent-pid");
  const childPid = path.join(f.root, "nested-child-pid");
  const interrupted = path.join(f.root, "nested-interrupted");
  const descendant = `process.on('SIGTERM',()=>{});require('node:fs').writeFileSync(${JSON.stringify(childPid)},String(process.pid));setInterval(()=>{},1000);`;
  const nestedChild = `process.on('SIGTERM',()=>{});require('node:fs').writeFileSync(${JSON.stringify(parentPid)},String(process.pid));` +
    `require('node:child_process').spawn(process.execPath,['-e',${JSON.stringify(descendant)}],{stdio:'inherit'});setInterval(()=>{},1000);`;
  const module = new URL("../src/process.ts", import.meta.url).href;
  const adapter = `
    import { writeFileSync } from 'node:fs';
    import { runProcess, ProcessInterruptedError } from ${JSON.stringify(module)};
    writeFileSync(${JSON.stringify(adapterPid)}, String(process.pid));
    try {
      await runProcess([process.execPath,'-e',${JSON.stringify(nestedChild)}],
        {cwd:process.cwd(),input:'',timeoutMs:30000,forwardSignals:true});
    } catch (error) {
      if (!(error instanceof ProcessInterruptedError)) throw error;
      writeFileSync(${JSON.stringify(interrupted)}, JSON.stringify({signal:error.signal,
        listeners:process.listenerCount('SIGTERM')}));
    }
  `;
  const deadline = controlledDeadline(t, 1000);
  const execution = runProcess([process.execPath, "--import", import.meta.resolve("tsx"),
    "--input-type=module", "-e", adapter], { cwd: f.root, input: "", timeoutMs: 1000 });
  try {
    const pid = await waitForPid(childPid);
    assert.ok(isRunning(pid));
    deadline.expire();
    const result = await within(execution, 'Nested adapter did not finish after timeout');
    assert.equal(result.timedOut, true);
    assert.equal(digest(await readJson(interrupted)), digest({ signal: "SIGTERM", listeners: 0 }));
    await assertStopped([pid, await waitForPid(parentPid), await waitForPid(adapterPid)]);
  } finally {
    deadline.expire();
    await cleanupProcesses([adapterPid, parentPid, childPid]);
    await within(execution, 'Nested adapter cleanup did not finish');
  }
});

test("timeout escalates when a process ignores SIGTERM", async (t) => {
  const f = await fixture(t);
  const ready = path.join(f.root, "ignores-term");
  const code = `process.on('SIGTERM',()=>{});require('node:fs').writeFileSync(${JSON.stringify(ready)},String(process.pid));setInterval(()=>{},1000);`;
  const deadline = controlledDeadline(t, 150);
  const execution = runProcess([process.execPath, "-e", code],
    { cwd: f.root, input: "", timeoutMs: 150 });
  try {
    const pid = await waitForPid(ready);
    assert.ok(isRunning(pid));
    deadline.expire();
    const result = await within(execution, 'SIGTERM-ignoring process did not finish');
    assert.equal(result.timedOut, true);
    assert.equal(result.signal, "SIGKILL");
    await assertStopped([pid]);
  } finally {
    deadline.expire();
    await cleanupProcesses([ready]);
    await within(execution, 'SIGTERM-ignoring process cleanup did not finish');
  }
});

test("interrupting runPlan stops its nested child and does not start the next job", async (t) => {
  const f = await fixture(t);
  await prepare(f.cases, { ...f.config, timeout: 30 }, f.out);
  const started = path.join(f.root, "interrupt-child-ready");
  const adapterPid = path.join(f.root, "interrupt-adapter-pid");
  const supervisorPid = path.join(f.root, "supervisor-pid");
  const stopped = path.join(f.root, "supervisor-stopped");
  const jobStarts = path.join(f.root, "job-starts");
  const child = `process.on('SIGTERM',()=>{});require('node:fs').writeFileSync(${JSON.stringify(started)},String(process.pid));setInterval(()=>{},1000);`;
  const processModule = new URL("../src/process.ts", import.meta.url).href;
  const runnerModule = new URL("../src/runner.ts", import.meta.url).href;
  const adapter = `import {readFileSync,writeFileSync,appendFileSync} from 'node:fs';
    import {runProcess} from ${JSON.stringify(processModule)};
    writeFileSync(${JSON.stringify(adapterPid)},String(process.pid));
    appendFileSync(${JSON.stringify(jobStarts)},JSON.parse(readFileSync(0,'utf8')).job_id+'\\n');
    await runProcess([process.execPath,'-e',${JSON.stringify(child)}],
      {cwd:process.cwd(),input:'',timeoutMs:30000,forwardSignals:true});`;
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
    "--input-type=module", "-e", supervisor], { cwd: f.root, input: "", timeoutMs: 30000 });
  try {
    const pid = await waitForPid(started);
    assert.ok(isRunning(pid));
    const supervisor = await waitForPid(supervisorPid);
    process.kill(supervisor, "SIGINT");
    const result = await within(execution, 'Interrupted runPlan did not finish');
    assert.equal(result.timedOut, false);
    assert.equal(result.exitCode, 0);
    assert.equal(await readFile(stopped, "utf8"), "SIGINT");
    assert.equal((await readRecords(path.join(f.out, "runs.jsonl"))).length, 0);
    assert.equal(await readFile(jobStarts, "utf8"), "A-0001-001\n");
    await assert.rejects(readFile(path.join(f.out, "jobs/B-0001-001/result.json")), /ENOENT/);
    await assertStopped([pid, supervisor, await waitForPid(adapterPid)]);
  } finally {
    await cleanupProcesses([supervisorPid, adapterPid, started]);
    await within(execution, 'Interrupted runPlan cleanup did not finish');
  }
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

test('provider envelope records actual model and tokens without treating response IDs as versions', async t => {
  const f = await fixture(t);
  const plan = await prepare(f.cases, { ...f.config, conditions: ['A'], repeats: 2 }, f.out);
  const runs = await f.execute(`
    const req = JSON.parse(require('node:fs').readFileSync(0, 'utf8'));
    console.log(JSON.stringify({schema:'graduation-wiki-eval/adapter-v1',
      output:{action:'answer',facts:{toy_result:7},answer_text:'Fixture',citations:req.context.sources},
      usage:{input_tokens:100,output_tokens:20},
      runtime:{provider:'openai',model:'actual-snapshot',requested_model:'requested',model_config:'fixed',
        tools:'none-inline-text',runtime:'test',response_id:req.job_id}}));
  `);
  assert.equal(runs.length, 2);
  for (const run of runs) {
    assert.equal(run.status, 'ok'); assert.equal(run.input_tokens, 100); assert.equal(run.output_tokens, 20);
    assert.equal(run.versions.model, 'actual-snapshot');
    assert.equal(run.versions.provider, 'openai');
    assert.ok(!Object.hasOwn(run.versions, 'response_id'));
  }
  assert.deepEqual(runs[0]?.versions, runs[1]?.versions);
  const report = evaluate(f.cases, runs, [], plan.evaluation_plan);
  assert.ok(!report.gates.A?.reasons.includes('mixed_versions_within_condition'));
});
