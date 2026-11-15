import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { test, type TestContext } from 'node:test';
import { digest } from '../src/json.js';
import { recheckSourceCitations } from '../src/source-recheck.js';

const hash = (text: string | Buffer) => 'sha256:' + createHash('sha256').update(text).digest('hex');
const contractPath = 'context/sources/source.json';
async function fixture(t: TestContext) {
  const cwd = await mkdtemp(path.join(tmpdir(), 'source-recheck-'));
  t.after(async () => rm(cwd, { recursive: true, force: true }));
  await mkdir(path.join(cwd, 'context/sources'), { recursive: true });
  const pdf = '%PDF-fixture', text = '학점 합계 6\f';
  const contract = { schema: 'graduation-wiki-eval/source-contract-v1', source_id: 'fixture', edition: '2026-2',
    pdf: { path: 'context/sources/original.pdf', sha256: hash(pdf), pages: 1 },
    text: { path: 'context/sources/original.txt', sha256: hash(text), format: 'pdftotext-layout-formfeed' } };
  const request = { job_id: 'A-1', case_id: 'fixture', condition: 'A', question: 'Fictional case', inputs: { policy_edition: '2026-2' },
    context: { sources: [contractPath, contract.pdf.path, contract.text.path], wiki: [], skills: [] }, instructions: '', output_contract: {} };
  const answer = { action: 'answer', facts: { credits: 6 }, answer_text: 'Fictional case.', citations: ['[source=fixture;edition=2026-2;pdf_page=1] 학점 합계 6'] };
  const trace = { schema: 'graduation-wiki-eval/claude-tools-v1', complete: true, request_sha256: digest(request),
    process: { exit_code: 0, timed_out: false, output_limit_exceeded: false },
    calls: [{ tool: 'Read', path: contract.pdf.path, status: 'success', delivered_pages: { start: 1, count: 1 } }] };
  const previous = { schema: 'graduation-wiki-eval/source-check-v1', status: 'fail', request_sha256: digest(request),
    output_sha256: digest(answer), contract_sha256: hash(JSON.stringify(contract)), pdf_sha256: contract.pdf.sha256,
    text_sha256: contract.text.sha256, source_id: contract.source_id, edition: contract.edition, candidate_output: answer };
  const files = { 'request.json': JSON.stringify(request), 'claude-tools.json': JSON.stringify(trace), 'source-check.json': JSON.stringify(previous),
    [contractPath]: JSON.stringify(contract), [contract.pdf.path]: pdf, [contract.text.path]: text,
    'runs.jsonl': 'keep original failed run', 'report.json': 'keep original report' };
  for (const [file, value] of Object.entries(files)) await writeFile(path.join(cwd, file), value);
  return { cwd, files, answer, previous, trace };
}

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
