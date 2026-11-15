import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { test } from 'node:test';
import { savedResponseFixture as fixture, hash, contractPath } from './helpers/saved-response.js';
import { digest } from '../src/json.js';
import { recheckSourceCitations } from '../src/source-recheck.js';


test('offline recheck accepts a real short quote and preserves all original records', async t => {
  const { cwd, files, answer } = await fixture(t);
  const out = path.join(cwd, 'new/recheck.json');
  const result = await recheckSourceCitations(cwd, contractPath, undefined, out);
  assert.equal(result.previous_status, 'fail');
  assert.equal(result.source_check.status, 'pass');
  assert.equal(result.source_check.output_sha256, digest(answer));
  assert.equal(result.source_check.schema, 'graduation-wiki-eval/source-check-v3');
  assert.equal(result.mode, 'offline_recheck');
  assert.equal(result.model_calls, 0);
  assert.equal(result.source_check.semantic_support, 'requires_review');
  for (const [file, original] of Object.entries(files)) assert.equal(await readFile(path.join(cwd, file), 'utf8'), original);
  await assert.rejects(recheckSourceCitations(cwd, contractPath, undefined, out), /EEXIST/);
  assert.deepEqual(JSON.parse(await readFile(out, 'utf8')), result);
});

test('changed answers, mismatched traces, incomplete streams and source edits cannot be silently rechecked', async t => {
  for (const variant of ['answer', 'trace', 'incomplete', 'source', 'contract']) {
    const { cwd, answer, previous, trace } = await fixture(t);
    if (variant === 'answer') await writeFile(path.join(cwd, 'source-check.json'), JSON.stringify({ ...previous, candidate_output: { ...answer, facts: { credits: 9 } } }));
    if (variant === 'trace') await writeFile(path.join(cwd, 'claude-tools.json'), JSON.stringify({ ...trace, request_sha256: hash('other') }));
    if (variant === 'incomplete') await writeFile(path.join(cwd, 'claude-tools.json'), JSON.stringify({ ...trace, complete: false }));
    if (variant === 'source') await writeFile(path.join(cwd, 'context/sources/original.txt'), 'changed source');
    if (variant === 'contract') await writeFile(path.join(cwd, 'source-check.json'), JSON.stringify({ ...previous, contract_sha256: hash('other') }));
    await assert.rejects(recheckSourceCitations(cwd, contractPath, undefined, path.join(cwd, 'new.json')));
  }
});

test('source-recheck CLI works without credentials or a model executable', async t => {
  const { cwd } = await fixture(t);
  const cli = new URL('../dist/cli.js', import.meta.url).pathname;
  const { stdout } = await promisify(execFile)(process.execPath, [cli, 'source-recheck', '--job', cwd,
    '--source-contract', contractPath, '--out', path.join(cwd, 'cli.json')], { env: { PATH: '' } });
  const result = JSON.parse(stdout);
  assert.equal(result.status, 'pass');
  assert.equal(result.model_calls, 0);
});
