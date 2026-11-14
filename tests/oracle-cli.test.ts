import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseCases } from '../src/schema.js';
import { readJson, readRecords } from '../src/json.js';
import { validateOracleWorkspace, updateOracleEntry } from '../src/oracle-review.js';

const cli = fileURLToPath(new URL('../dist/cli.js', import.meta.url));
const sample = fileURLToPath(new URL('../sample/cases.jsonl', import.meta.url));
function invoke(cwd: string, args: string[], status = 0): string {
  const result = spawnSync(process.execPath, [cli, ...args], { cwd, encoding: 'utf8', timeout: 20_000 });
  assert.equal(result.error, undefined);
  assert.equal(result.status, status, result.stderr || result.stdout);
  return result.stdout;
}

test('oracle commands resume a saved review and export an explicitly selected verified subset', async t => {
  const cwd = await mkdtemp(join(tmpdir(), 'grad-oracle-cli-'));
  t.after(() => rm(cwd, { recursive: true, force: true }));
  invoke(cwd, ['oracle-init', '--cases', sample, '--out', 'review.json', '--title', '가상 자료 검토']);
  let workspace = await validateOracleWorkspace(await readJson(join(cwd, 'review.json')));
  assert.equal(workspace.title, '가상 자료 검토');
  assert.ok(workspace.entries.every(entry => entry.status === 'pending'));
  const first = workspace.entries[0]; assert.ok(first);
  workspace = await updateOracleEntry(workspace, first.source.id, { reviewer: 'software-test-only', note: '가상 자료를 이용한 자동 테스트입니다.' });
  workspace = await updateOracleEntry(workspace, first.source.id, { status: 'approved' });
  await writeFile(join(cwd, 'saved.json'), JSON.stringify(workspace));
  const args = ['oracle-export', '--cases', sample, '--workspace', 'saved.json', '--out', 'confirmed.jsonl'];
  invoke(cwd, args, 2);
  await assert.rejects(readFile(join(cwd, 'confirmed.jsonl')), /ENOENT/);
  const result = JSON.parse(invoke(cwd, [...args, '--approved-only'])) as { cases: number; omitted: number };
  assert.equal(result.cases, 1);
  assert.equal(result.omitted, workspace.entries.length - 1);
  const exported = parseCases(await readRecords(join(cwd, 'confirmed.jsonl')));
  assert.equal(exported[0]?.review_status, 'verified');
  assert.equal(exported[0]?.oracle_reviewer, 'software-test-only');
  assert.equal(exported[0]?.origin, 'synthetic');
  invoke(cwd, ['validate', '--cases', 'confirmed.jsonl']);
  invoke(cwd, ['plan', '--cases', 'confirmed.jsonl', '--out', 'new-plan.json']);
});

test('oracle commands reject unrelated cases, altered approvals and existing outputs', async t => {
  const cwd = await mkdtemp(join(tmpdir(), 'grad-oracle-errors-'));
  t.after(() => rm(cwd, { recursive: true, force: true }));
  invoke(cwd, ['oracle-init', '--cases', sample, '--out', 'review.json']);
  const original = await readFile(join(cwd, 'review.json'), 'utf8');
  invoke(cwd, ['oracle-init', '--cases', sample, '--out', 'review.json'], 2);
  assert.equal(await readFile(join(cwd, 'review.json'), 'utf8'), original);
  let workspace = await validateOracleWorkspace(await readJson(join(cwd, 'review.json')));
  for (const entry of workspace.entries) {
    workspace = await updateOracleEntry(workspace, entry.source.id, { reviewer: 'software-test-only' });
    workspace = await updateOracleEntry(workspace, entry.source.id, { status: 'approved' });
  }
  await writeFile(join(cwd, 'approved.json'), JSON.stringify(workspace));
  const args = ['oracle-export', '--cases', sample, '--workspace', 'approved.json', '--out', 'confirmed.jsonl'];
  invoke(cwd, args);
  const confirmed = await readFile(join(cwd, 'confirmed.jsonl'), 'utf8');
  invoke(cwd, args, 2);
  assert.equal(await readFile(join(cwd, 'confirmed.jsonl'), 'utf8'), confirmed);
  const alteredCases = parseCases(await readRecords(sample));
  const firstCase = alteredCases[0]; assert.ok(firstCase); firstCase.question += ' 변경';
  await writeFile(join(cwd, 'changed.json'), JSON.stringify(alteredCases));
  invoke(cwd, ['oracle-export', '--cases', 'changed.json', '--workspace', 'approved.json', '--out', 'stale.jsonl'], 2);
  await assert.rejects(readFile(join(cwd, 'stale.jsonl')), /ENOENT/);
  const firstEntry = workspace.entries[0]; assert.ok(firstEntry); firstEntry.draft.question += ' 변경';
  await writeFile(join(cwd, 'tampered.json'), JSON.stringify(workspace));
  invoke(cwd, ['oracle-export', '--cases', sample, '--workspace', 'tampered.json', '--out', 'tampered.jsonl'], 2);
  await assert.rejects(readFile(join(cwd, 'tampered.jsonl')), /ENOENT/);
});
