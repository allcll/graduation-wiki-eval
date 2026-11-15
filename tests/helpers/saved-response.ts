import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { TestContext } from 'node:test';
import { digest } from '../../src/json.js';
import type { AdapterRequest } from '../../src/adapters/request.js';

export const hash = (text: string | Buffer) => 'sha256:' + createHash('sha256').update(text).digest('hex');
export const contractPath = 'context/sources/source.json';
export async function savedResponseFixture(t: TestContext) {
  const cwd = await mkdtemp(path.join(tmpdir(), 'source-recheck-'));
  t.after(async () => rm(cwd, { recursive: true, force: true }));
  await mkdir(path.join(cwd, 'context/sources'), { recursive: true });
  const pdf = '%PDF-fixture', text = '학점 합계 6\f';
  const contract = { schema: 'graduation-wiki-eval/source-contract-v1', source_id: 'fixture', edition: '2026-2',
    pdf: { path: 'context/sources/original.pdf', sha256: hash(pdf), pages: 1 },
    text: { path: 'context/sources/original.txt', sha256: hash(text), format: 'pdftotext-layout-formfeed' } };
  const request: AdapterRequest = { job_id: 'A-1', case_id: 'fixture', condition: 'A', question: 'Fictional case', inputs: { policy_edition: '2026-2' },
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
  return { cwd, files, answer, previous, trace, request, contract };
}
