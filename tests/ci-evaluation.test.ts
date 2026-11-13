import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test, type TestContext } from 'node:test';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { createPublicSummary, failedPublicSummary, parsePublicSummary, renderPublicSummary } from '../scripts/ci-summary.mjs';
import { buildCommands, containedPath, modelConfig, parseOptions, relativeInput } from '../scripts/evaluate-ci.mjs';
import { digest } from '../src/json.js';
import { datasetHash, evaluate, makePlan } from '../src/evaluate.js';
import { HARNESS_VERSION, parseCases, type Review, type Run, versionsSchema, VERSION_KEYS } from '../src/schema.js';

const engineRoot = fileURLToPath(new URL('../', import.meta.url));
const execute = promisify(execFile);
const secret = 'PRIVATE-TEXT-MUST-NOT-BE-PUBLISHED';
const claudeArgs = ['--mode', 'claude', '--out', 'output', '--cases', 'eval/cases.jsonl', '--config', 'eval/run.json',
  '--model', 'claude-test-20261113', '--max-budget-usd', '0.1', '--claude-version', '2.1.322'];

async function temporary(t: TestContext) {
  const root = await mkdtemp(path.join(tmpdir(), 'grad-eval-ci-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  return root;
}

function privateReport() {
  const cases = parseCases([{
    id: `${secret}-case`, family: `${secret}-family`, split: 'dev', origin: 'synthetic', review_status: 'draft',
    independent_reference: false, question: secret, inputs: { note: secret },
    expected: { action: 'answer', facts: { value: 1 } },
    sources: [{ id: secret, version: secret, locator: secret, excerpt: secret, authoritative: false }],
    rubric: { version: secret, criteria: [
      { id: 'answer', dimension: 'answer', severity: 'blocker', description: secret },
      { id: 'source', dimension: 'evidence', severity: 'major', description: secret },
      { id: 'style', dimension: 'answer', severity: 'minor', description: secret },
    ] },
  }]);
  const item = cases[0];
  assert.ok(item);
  const output = { action: 'answer' as const, facts: { value: 1 }, answer_text: secret, citations: [secret] };
  const versions = versionsSchema.parse({ ...Object.fromEntries(VERSION_KEYS.map(key => [key, secret])),
    dataset: datasetHash(cases), harness: HARNESS_VERSION });
  const runs: Run[] = [{ run_id: secret, case_id: item.id, case_sha256: digest(item), condition: 'C', repeat: 1,
    execution: 'synthetic', started_at: secret, status: 'ok', versions, output, output_sha256: digest(output) }];
  const reviews: Review[] = [{ run_id: secret, case_sha256: digest(item), output_sha256: digest(output),
    reviewer_kind: 'human', reviewer_id: secret, reviewed_at: secret, rubric_sha256: digest(item.rubric),
    criterion_results: item.rubric.criteria.map(criterion => ({ criterion_id: criterion.id, verdict: 'fail', rationale: secret })) }];
  return evaluate(cases, runs, reviews, makePlan(cases, ['C']));
}

test('public summary validates the report and drops every free-text field', async () => {
  const report = privateReport();
  assert.ok(JSON.stringify(report).includes(secret));
  const summary = await createPublicSummary(report, 'sample');
  assert.ok(!JSON.stringify(summary).includes(secret));
  assert.ok(!renderPublicSummary(summary).includes(secret));
  assert.equal(summary.conditions[0]?.gate, 'INCONCLUSIVE');
  assert.equal(summary.conditions[0]?.requiredFail, 1);
  assert.equal(summary.conditions[0]?.advisoryRuns, 1);
  assert.deepEqual(summary.conditions[0]?.criterionFailures, { blocker: 1, major: 1, minor: 1 });
  report.overall_counts.expected += 1;
  await assert.rejects(createPublicSummary(report, 'sample'), /counts/);
});

test('untrusted summaries reject private extras, invalid numbers and invented conditions', async () => {
  const summary = await createPublicSummary(privateReport(), 'sample');
  const row = summary.conditions[0];
  assert.ok(row);
  for (const bad of [
    { ...summary, rationale: secret },
    { ...summary, conditions: [{ ...row, answer_text: secret }] },
    { ...summary, conditions: [{ ...row, criterionFailures: { ...row.criterionFailures, explanation: secret } }] },
    { ...summary, conditions: [{ ...row, condition: secret }] },
    { ...summary, conditions: [{ ...row, expected: Number.NaN }] },
    { ...summary, conditions: [{ ...row, missing: -1 }] },
    { ...summary, conditions: [{ ...row, expected: 0 }] },
    { ...summary, conditions: [{ ...row, gate: 'PASS' }] },
    { ...summary, conditions: [row, row] },
  ]) assert.throws(() => parsePublicSummary(bad));
  assert.equal(failedPublicSummary('sample').execution, 'failed');
  assert.match(renderPublicSummary(summary), /품질 판정은 holdout/);
});

test('CI arguments cannot select arbitrary executables or inject shell commands', () => {
  for (const args of [
    ['--mode', 'sample', '--out', 'output', '--adapter', 'evil'],
    ['--mode', 'sample', '--out', 'output', '--cases', 'private.jsonl'],
    [...claudeArgs, '--model', 'claude-1; touch PWNED'],
    [...claudeArgs, '--max-budget-usd', '0.1;echo PRIVATE'],
    [...claudeArgs, '--claude-version', '2.1.322 && echo PRIVATE'],
    [...claudeArgs, '--model', 'sonnet'],
    [...claudeArgs, '--model', 'claude-latest-1'],
    [...claudeArgs, '--max-turns', '1.5'],
    [...claudeArgs, '--timeout', 'Infinity'],
  ]) assert.throws(() => parseOptions(args));
  const options = parseOptions([...claudeArgs, '--out', 'literal $(touch SHOULD_NOT_EXIST)']);
  const commands = buildCommands(options);
  assert.deepEqual(commands.map(command => command[1]), ['prepare', 'run', 'review-template', 'report']);
  const run = commands[1];
  assert.ok(run);
  const delimiter = run.indexOf('--');
  assert.equal(run[delimiter + 1], process.execPath);
  assert.equal(run[delimiter + 2], path.join(engineRoot, 'dist/adapters/claude.js'));
  assert.ok(commands[0]?.includes(path.join(options.out, 'raw/cases.jsonl')));
  assert.ok(!commands.flat().includes('--check'));
});

test('case and config lookup rejects traversal and symlink escape', async (t) => {
  const root = await temporary(t);
  const data = path.join(root, 'data');
  await mkdir(data);
  await writeFile(path.join(data, 'safe.json'), '{}');
  await writeFile(path.join(root, 'outside.json'), secret);
  await symlink(path.join(root, 'outside.json'), path.join(data, 'escape.json'));
  assert.equal(await containedPath(data, 'safe.json'), await realpath(path.join(data, 'safe.json')));
  await assert.rejects(containedPath(data, './safe.json'), /relative/);
  for (const value of ['../outside.json', '/absolute.json', 'a\\b.json', 'a/../outside.json', '']) assert.throws(() => relativeInput(value));
  await assert.rejects(containedPath(data, 'escape.json'), /escapes/);
});

test('runtime metadata is derived from actual Claude arguments', () => {
  const options = parseOptions(claudeArgs);
  const config = modelConfig({ model: 'wrong', model_config: 'wrong', runtime: 'wrong', tools: 'wrong',
    execution: 'synthetic', timeout: 1, prompt: 'unchanged' }, options);
  assert.equal(config.model, 'claude-test-20261113');
  assert.equal(config.execution, 'real');
  assert.equal(config.timeout, 150);
  assert.equal(config.tools, 'Read,Grep,Glob; native-skills-disabled');
  assert.equal(config.runtime, `node-${process.versions.node};claude-code-2.1.322`);
  assert.deepEqual(JSON.parse(String(config.model_config)), { budget_usd: 0.1, max_turns: 12, effort: 'medium', timeout_seconds: 120 });
  assert.equal(config.prompt, 'unchanged');
});

test('local CI entry executes the four CLI stages and preserves private review files locally', async (t) => {
  const root = await temporary(t);
  const out = path.join(root, 'literal $(touch SHOULD_NOT_EXIST)');
  const { stdout } = await execute(process.execPath, ['scripts/evaluate-ci.mjs', '--mode', 'sample', '--out', out],
    { cwd: engineRoot, env: { ...process.env, ANTHROPIC_API_KEY: '', GITHUB_STEP_SUMMARY: '' }, timeout: 20_000 });
  const summary = parsePublicSummary(JSON.parse(stdout));
  assert.equal(summary.execution, 'completed');
  assert.equal(summary.conditions.length, 3);
  assert.ok(summary.conditions.every(row => row.expected === 3 && row.reviewPending === 3 && row.gate === 'INCONCLUSIVE'));
  assert.match(await readFile(path.join(out, 'raw/reviews.md'), 'utf8'), /정답과 근거/);
  assert.ok((await readFile(path.join(out, 'raw/reviews.jsonl'), 'utf8')).includes('criterion_results'));
  assert.ok(!(await readFile(path.join(out, 'public/public-summary.json'), 'utf8')).includes('case_id'));
  await assert.rejects(readFile(path.join(engineRoot, 'SHOULD_NOT_EXIST')), /ENOENT/);
  await assert.rejects(execute(process.execPath, ['scripts/evaluate-ci.mjs', '--mode', 'sample', '--out', out],
    { cwd: engineRoot, env: { ...process.env, ANTHROPIC_API_KEY: '', GITHUB_STEP_SUMMARY: '' } }));
});

test('missing model credentials produce a bounded public failure without calling Claude', async (t) => {
  const root = await temporary(t);
  const out = path.join(root, 'missing-key');
  await assert.rejects(execute(process.execPath, ['scripts/evaluate-ci.mjs', ...claudeArgs,
    '--out', out, '--cases', `${secret}.jsonl`],
  { cwd: engineRoot, env: { ...process.env, ANTHROPIC_API_KEY: '', GITHUB_STEP_SUMMARY: '' } }), (error: unknown) => {
    assert.ok(error instanceof Error && 'code' in error && 'stdout' in error && 'stderr' in error);
    assert.equal(error.code, 1);
    assert.equal(typeof error.stdout, 'string');
    assert.equal(typeof error.stderr, 'string');
    const summary = parsePublicSummary(JSON.parse(String(error.stdout)));
    assert.equal(summary.mode, 'claude');
    assert.equal(summary.execution, 'failed');
    assert.deepEqual(summary.conditions, []);
    assert.ok(!String(error.stdout).includes(secret));
    assert.ok(!String(error.stderr).includes(secret));
    assert.ok(!String(error.stderr).includes('API key'));
    return true;
  });
  const summary = parsePublicSummary(JSON.parse(await readFile(path.join(out, 'public/public-summary.json'), 'utf8')));
  assert.equal(summary.execution, 'failed');
  await assert.rejects(readFile(path.join(out, 'raw/prepare.stdout.txt')), /ENOENT/);
});
