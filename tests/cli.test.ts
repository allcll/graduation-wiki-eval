import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readJson, readRecords } from '../src/json.js';
import { validateReport } from '../src/evaluate.js';
import { parseRuns } from '../src/schema.js';

const cli = fileURLToPath(new URL('../dist/cli.js', import.meta.url));
const sample = fileURLToPath(new URL('../sample/cases.jsonl', import.meta.url));
function invoke(cwd: string, args: string[], status = 0): string {
  const result = spawnSync(process.execPath, [cli, ...args], { cwd, encoding: 'utf8', timeout: 20_000 });
  assert.equal(result.error, undefined);
  assert.equal(result.status, status, result.stderr || result.stdout);
  return result.stdout;
}

test('CLI demo runs outside the repository and preserves synthetic review status', async t => {
  const cwd = await mkdtemp(join(tmpdir(), 'grad-cli-'));
  t.after(() => rm(cwd, { recursive: true, force: true }));
  invoke(cwd, ['demo', '--out', 'demo']);
  const report = validateReport(await readJson(join(cwd, 'demo/report.json')));
  assert.equal(report.overall_counts.expected, 9);
  assert.equal(report.overall_counts.objective_pass, 9);
  assert.equal(report.overall_counts.reviewed_success, 0);
  assert.ok(Object.values(report.gates).every(gate => gate.gate === 'INCONCLUSIVE'));

  const runsPath = join(cwd, 'demo/experiment/runs.jsonl');
  invoke(cwd, ['review-template', '--runs', runsPath, '--out', 'reviews.jsonl']);
  const templates = await readRecords(join(cwd, 'reviews.jsonl'));
  assert.equal(templates.length, 9);
  const reportArgs = ['report', '--cases', 'demo/cases.jsonl', '--runs', runsPath,
    '--plan', 'demo/experiment/plan.json', '--out', 'checked.json'];
  invoke(cwd, [...reportArgs, '--check'], 1);
  // A generated template has blank reviewer fields and cannot count as reviewed.
  invoke(cwd, [...reportArgs, '--reviews', 'reviews.jsonl'], 2);
  assert.match(await readFile(join(cwd, 'checked.json'), 'utf8'), /INCONCLUSIVE/);
  assert.doesNotMatch(await readFile(join(cwd, 'checked.md'), 'utf8'), /\| PASS \|/);

  const previous = await readFile(runsPath, 'utf8');
  invoke(cwd, ['demo', '--out', 'demo'], 2);
  invoke(cwd, ['review-template', '--runs', runsPath, '--out', 'reviews.jsonl'], 2);
  assert.equal(await readFile(runsPath, 'utf8'), previous);
  assert.equal(parseRuns(await readRecords(runsPath)).length, 9);
});

test('plan accepts comma-separated conditions and keeps every planned repetition', async t => {
  const cwd = await mkdtemp(join(tmpdir(), 'grad-cli-plan-'));
  t.after(() => rm(cwd, { recursive: true, force: true }));
  invoke(cwd, ['validate', '--cases', sample]);
  invoke(cwd, ['plan', '--cases', sample, '--conditions', 'A,C', '--repeats', '2', '--out', 'plan.json']);
  await writeFile(join(cwd, 'runs.jsonl'), '');
  invoke(cwd, ['report', '--cases', sample, '--runs', 'runs.jsonl', '--plan', 'plan.json', '--out', 'report.json', '--check'], 1);
  const report = validateReport(await readJson(join(cwd, 'report.json')));
  assert.equal(report.overall_counts.expected, 12);
  assert.equal(report.overall_counts.missing, 12);
  const previous = await readFile(join(cwd, 'plan.json'), 'utf8');
  invoke(cwd, ['plan', '--cases', sample, '--out', 'plan.json'], 2);
  assert.equal(await readFile(join(cwd, 'plan.json'), 'utf8'), previous);
});

test('invalid report input replaces stale success with an explicit incomplete report', async t => {
  const cwd = await mkdtemp(join(tmpdir(), 'grad-cli-error-'));
  t.after(() => rm(cwd, { recursive: true, force: true }));
  await writeFile(join(cwd, 'report.json'), '{"gate":"PASS"}');
  await writeFile(join(cwd, 'report.md'), 'PASS');
  invoke(cwd, ['report', '--cases', sample, '--runs', 'missing.jsonl', '--plan', 'missing.json', '--out', 'report.json'], 2);
  assert.match(await readFile(join(cwd, 'report.json'), 'utf8'), /"gate": "INCONCLUSIVE"/);
  assert.match(await readFile(join(cwd, 'report.md'), 'utf8'), /\*\*INCONCLUSIVE\*\*/);
});

test('report and companion Markdown cannot overwrite an input', async t => {
  const cwd = await mkdtemp(join(tmpdir(), 'grad-cli-collision-'));
  t.after(() => rm(cwd, { recursive: true, force: true }));
  const original = await readFile(sample, 'utf8');
  for (const extension of ['json', 'md']) {
    const input = `protected.${extension}`;
    await writeFile(join(cwd, input), original);
    invoke(cwd, ['report', '--cases', input, '--runs', 'unused.jsonl', '--plan', 'unused.json', '--out', 'protected.json'], 2);
    assert.equal(await readFile(join(cwd, input), 'utf8'), original);
  }
});

test('adapter arguments after the delimiter do not trigger top-level CLI help', async t => {
  const cwd = await mkdtemp(join(tmpdir(), 'grad-cli-args-'));
  t.after(() => rm(cwd, { recursive: true, force: true }));
  // The missing plan must be rejected; swallowing the adapter flag would exit 0.
  invoke(cwd, ['run', '--plan', 'missing.json', '--', process.execPath, '--help'], 2);
  invoke(cwd, ['plan', '--cases', sample, '--conditions', 'A', 'B', '--out', 'invalid.json'], 2);
  assert.match(invoke(cwd, ['--help']), /grad-eval/);
  assert.equal(invoke(cwd, ['--version']).trim(), '0.2.0');
});
