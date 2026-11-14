import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readJson, readRecords, writeRecords } from '../src/json.js';
import { validateReport } from '../src/evaluate.js';
import { prepare, runPlan } from '../src/runner.js';
import { parseCases } from '../src/schema.js';

const cli = fileURLToPath(new URL('../dist/cli.js', import.meta.url));
const fixture = fileURLToPath(new URL('../dist/fixture-agent.js', import.meta.url));
const sampleCases = new URL('../sample/cases.jsonl', import.meta.url);
const contextRoot = fileURLToPath(new URL('../sample/context', import.meta.url));

test('report binds prepared snapshot plans to runs while accepting standalone evaluation plans', async t => {
  const cwd = await mkdtemp(join(tmpdir(), 'grad-plan-binding-'));
  t.after(() => rm(cwd, { recursive: true, force: true }));
  const cases = parseCases((await readRecords(sampleCases)).slice(0, 1));
  await writeRecords(join(cwd, 'cases.jsonl'), cases);
  const config = {
    context_root: contextRoot, sources: ['original.md'], wiki: ['wiki.md'], skills: ['SKILL.md'],
    conditions: ['C'], repeats: 1, timeout: 10, execution: 'synthetic',
    model: 'fixture', model_config: 'none', prompt: 'binding-test-v1', code: 'none', data: 'fictional',
    tools: 'fixture', runtime: 'test', instructions: 'Use the fixed sample output contract.',
  };
  const plan = await prepare(cases, config, join(cwd, 'baseline'));
  const runs = await runPlan(join(cwd, 'baseline/plan.json'), [process.execPath, fixture]);
  const invoke = (planPath: string, runsPath: string, expectedStatus: number): void => {
    const result = spawnSync(process.execPath, [cli, 'report', '--cases', 'cases.jsonl', '--runs', runsPath,
      '--plan', planPath, '--out', 'report.json'], { cwd, encoding: 'utf8', timeout: 20_000 });
    assert.equal(result.error, undefined);
    assert.equal(result.status, expectedStatus, result.stderr || result.stdout);
  };

  invoke('baseline/plan.json', 'baseline/runs.jsonl', 0);
  assert.equal(validateReport(await readJson(join(cwd, 'report.json'))).overall_counts.expected, 1);

  // Same cases and evaluation grid, but a different frozen prompt snapshot.
  const other = await prepare(cases, { ...config, prompt: 'binding-test-v2' }, join(cwd, 'other'));
  assert.deepEqual(other.evaluation_plan, plan.evaluation_plan);
  assert.notEqual(other.plan_sha256, plan.plan_sha256);
  invoke('other/plan.json', 'baseline/runs.jsonl', 2);
  assert.match(JSON.stringify(await readJson(join(cwd, 'report.json'))), /does not belong to the supplied runner plan/);

  const changed = structuredClone(plan);
  changed.prompt_snapshot.instructions = 'Unrecorded change';
  await writeFile(join(cwd, 'tampered.json'), JSON.stringify(changed));
  invoke('tampered.json', 'baseline/runs.jsonl', 2);
  assert.match(JSON.stringify(await readJson(join(cwd, 'report.json'))), /Runner plan checksum mismatch/);

  const imported = runs.map(({ plan_sha256: _checksum, ...run }) => run);
  await writeRecords(join(cwd, 'imported.jsonl'), imported);
  invoke('baseline/plan.json', 'imported.jsonl', 2);
  assert.match(JSON.stringify(await readJson(join(cwd, 'report.json'))), /does not belong to the supplied runner plan/);

  // Other runners can still use the separate, frozen evaluation-only contract.
  await writeFile(join(cwd, 'evaluation-plan.json'), JSON.stringify(plan.evaluation_plan));
  invoke('evaluation-plan.json', 'imported.jsonl', 0);
  assert.equal(validateReport(await readJson(join(cwd, 'report.json'))).overall_counts.expected, 1);
});
