import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test, type TestContext } from 'node:test';
import { invokeClaude, buildCommand } from '../src/adapters/claude.js';
import { summarizeClaudeStream } from '../src/adapters/claude-trace.js';
import { checkSourceCitations, loadSourceContract, sourceCitationInstructions, type SourceContract } from '../src/adapters/source-citations.js';
import type { AdapterAnswer, AdapterRequest } from '../src/adapters/request.js';
import type { ProcessResult } from '../src/process.js';

const pdf = 'context/sources/handbook.pdf';
const text = 'context/sources/handbook.txt';
const manifest = 'context/sources/source.json';
const page1 = 'Fictional handbook 2026-2\n';
const page2 = 'Students complete two distinct areas.\nEach listed course awards three credits.\n';
const hash = (text: string) => 'sha256:' + createHash('sha256').update(text).digest('hex');
const pdfBytes = '%PDF-1.7\nFictional fixture; not an actual PDF.';
const textBytes = page1 + '\f' + page2 + '\f';
const contract: SourceContract = { schema: 'graduation-wiki-eval/source-contract-v1', source_id: 'handbook', edition: '2026-2',
  pdf: { path: pdf, sha256: hash(pdfBytes), pages: 2 }, text: { path: text, sha256: hash(textBytes), format: 'pdftotext-layout-formfeed' } };
const request: AdapterRequest = { job_id: 'A-1', case_id: 'fictional', condition: 'A', question: 'What does the handbook require?',
  inputs: { policy_edition: '2026-2' }, context: { sources: [pdf, text, manifest], wiki: [], skills: [] }, instructions: '', output_contract: {} };
const citation = '[source=handbook;edition=2026-2;pdf_page=2] Students complete two distinct areas.';
const answer: AdapterAnswer = { action: 'answer', facts: { areas: 2 }, answer_text: 'Two areas.', citations: [citation] };
const finish = (output: AdapterAnswer) => ({ type: 'result', subtype: 'success', is_error: false, structured_output: output });
const use = { type: 'assistant', message: { content: [{ type: 'tool_use', id: 'p', name: 'Read', input: { file_path: pdf, pages: '2' } }] } };
const reply = (firstPage: number | undefined = 2, count = 1, images = 1) => ({ type: 'user',
  tool_use_result: { type: 'parts', file: { filePath: pdf, count, outputDir: '/PRIVATE/path' }, firstPage },
  message: { content: [{ type: 'tool_result', tool_use_id: 'p', content: Array.from({ length: images }, () =>
    ({ type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'PRIVATE_IMAGE_BYTES' } })) }] } });
const stream = (output = answer, result = reply()) => [use, result, finish(output)].map(item => JSON.stringify(item)).join('\n');
const trace = (output = answer, result = reply()) => summarizeClaudeStream(stream(output, result), request, '/tmp/job').trace;
const loaded = { contract, pages: [page1, page2], contract_sha256: 'sha256:fixture' };

test('source instructions identify supported tables and keep other tables on individual fragments', () => {
  assert.match(sourceCitationInstructions(contract), /No table index/);
  const prompt = sourceCitationInstructions(contract, [{ id: 'p53-balance', pdf_page: 53 }]);
  assert.match(prompt, /"pdf_page":53/);
  assert.match(prompt, /single comma may separate complete cells/);
  assert.match(prompt, /For all other tables, cite individual verbatim fragments separately/);
});

async function fixture(t: TestContext) {
  const cwd = await mkdtemp(path.join(tmpdir(), 'source-check-'));
  t.after(async () => rm(cwd, { recursive: true, force: true }));
  await mkdir(path.join(cwd, 'context/sources'), { recursive: true });
  for (const [file, body] of [[pdf, pdfBytes], [text, textBytes], [manifest, JSON.stringify(contract)]]) {
    await writeFile(path.join(cwd, file!), body!);
  }
  return cwd;
}

test('source identity is checked against the request edition and exact snapshot bytes', async t => {
  const cwd = await fixture(t);
  assert.deepEqual((await loadSourceContract(manifest, request, cwd)).pages, [page1, page2]);
  await assert.rejects(loadSourceContract('../outside.json', request, cwd), /listed/);
  await assert.rejects(loadSourceContract(manifest, { ...request, inputs: { policy_edition: '2026-1' } }, cwd), /edition/);
  for (const changed of [
    { ...contract, pdf: { ...contract.pdf, path: '../outside.pdf' } },
    { ...contract, text: { ...contract.text, sha256: hash('different') } },
    { ...contract, pdf: { ...contract.pdf, pages: 3 } },
  ]) {
    await writeFile(path.join(cwd, manifest), JSON.stringify(changed));
    await assert.rejects(loadSourceContract(manifest, request, cwd));
  }
  await writeFile(path.join(cwd, manifest), JSON.stringify(contract));
  await writeFile(path.join(cwd, pdf), pdfBytes + 'changed');
  await assert.rejects(loadSourceContract(manifest, request, cwd), /checksum/);
});

test('edition aliases accept existing cases but reject missing, invalid and conflicting declarations', async t => {
  const cwd = await fixture(t);
  for (const inputs of [{ policy_term: '2026-2' }, { policy_edition: '2026-2', policy_term: '2026-2' }]) {
    assert.equal((await loadSourceContract(manifest, { ...request, inputs }, cwd)).contract.edition, '2026-2');
  }
  for (const inputs of [{}, { policy_term: '2026-1' }, { policy_edition: null, policy_term: '2026-2' },
    { policy_edition: '2026-2', policy_term: '2026-1' }, { policy_edition: '2026-1', policy_term: '2026-2' }]) {
    await assert.rejects(loadSourceContract(manifest, { ...request, inputs }, cwd), /edition/);
  }
});

test('citation checks require returned page images, the correct edition and a literal quote on that page', () => {
  const check = checkSourceCitations(answer, trace(), loaded);
  assert.equal(check.status, 'pass');
  assert.equal(check.semantic_support, 'requires_review');
  assert.deepEqual(check.delivered_pdf_pages, [{ start: 2, count: 1 }]);
  assert(!JSON.stringify(trace()).includes('PRIVATE'));
  const variants = [
    [], ['WIKI 2026-1 p.52'],
    [citation.replace('2026-2', '2026-1')], [citation.replace('source=handbook', 'source=other')],
    [citation.replace('pdf_page=2', 'pdf_page=1')], [citation.replace('pdf_page=2', 'pdf_page=3')],
    [citation.replace('two distinct', 'three different')], [citation, 'Skill calculation procedure'],
    ['[source=handbook;edition=2026-2;pdf_page=2]    '],
  ];
  for (const citations of variants) assert.equal(checkSourceCitations({ ...answer, citations }, trace(), loaded).status, 'fail');
  assert.equal(checkSourceCitations({ ...answer, citations: [citation.replace('two distinct', 'two\n  distinct')] }, trace(), loaded).status, 'pass');
  assert.equal(checkSourceCitations({ ...answer, citations: ['[source=handbook;edition=2026-2;pdf_page=2] two'] }, trace(), loaded).status, 'pass');
  // A real quote can still accompany an incorrect interpretation. Never call this semantic PASS.
  assert.equal(checkSourceCitations({ ...answer, answer_text: 'Only one area is needed.', facts: { areas: 1 } }, trace(), loaded).semantic_support, 'requires_review');
});

test('requested pages, missing images, failed reads and incomplete streams cannot establish source verification', () => {
  for (const response of [reply(1), reply(2, 1, 0), reply(2, 2, 1), reply(3)]) {
    assert.equal(checkSourceCitations(answer, trace(answer, response), loaded).status, 'fail');
  }
  const noMetadata = reply();
  Object.assign(noMetadata.tool_use_result, { firstPage: undefined });
  assert.equal(checkSourceCitations(answer, trace(answer, noMetadata), loaded).status, 'fail');
  const failed = { ...reply(), message: { content: [{ ...reply().message.content[0], is_error: true }] } };
  assert.equal(checkSourceCitations(answer, summarizeClaudeStream([use, failed, finish(answer)].map(x => JSON.stringify(x)).join('\n'), request, '/tmp/job').trace, loaded).status, 'fail');
  assert.equal(checkSourceCitations(answer, { ...trace(), complete: false }, loaded).status, 'fail');
  const searchOnly = { ...trace(), calls: trace().calls.map(call => ({ ...call, tool: 'Grep' as const })) };
  assert.equal(checkSourceCitations(answer, searchOnly, loaded).status, 'fail');
});

test('paired quotation typography is separate from literal matching and preserves substantive text', () => {
  const sentence = '창의소프트학부는 ‘문화와예술’ 영역 제외.';
  const check = (page: string, quote: string) => checkSourceCitations({ ...answer,
    citations: [`[source=handbook;edition=2026-2;pdf_page=2] ${quote}`] }, trace(), { ...loaded, pages: [page1, page] });
  for (const quote of [
    "창의소프트학부는 '문화와예술' 영역 제외.",
    '창의소프트학부는 "문화와예술" 영역 제외.', '창의소프트학부는 문화와예술 영역 제외.',
  ]) {
    const result = check(sentence, quote);
    assert.equal(result.status, 'pass');
    assert.equal(result.citations[0]?.literal_match, false);
    assert.equal(result.citations[0]?.match_basis, 'normalized_text');
  }
  for (const [page, quote] of [
    [sentence, '창의소프트학부는 자연과과학 영역 제외.'],
    ['2012학년도 입학자부터', '2012학번도 입학자부터'],
    ['학생 자율선택', '학생 자유선택'],
    ['Students cannot waive this.', 'Students can waive this.'],
    ["Students don't waive this.", 'Students dont waive this.'],
    ['At least 1.5 credits, ages 2-4, and 1,200 points.', 'At least 15 credits, ages 24, and 1200 points.'],
    ['Height 5\'9".', 'Height 59.'],
    [sentence, "창의소프트학부는 '문화와예술 영역 제외."],
  ]) assert.equal(check(page!, quote!).status, 'fail', quote);
  const quote = "창의소프트학부는 '문화와예술' 영역 제외.";
  assert.equal(checkSourceCitations({ ...answer, citations: [`[source=handbook;edition=2026-1;pdf_page=2] ${quote}`] }, trace(), { ...loaded, pages: [page1, sentence] }).status, 'fail');
  assert.equal(checkSourceCitations({ ...answer, citations: [`[source=handbook;edition=2026-2;pdf_page=2;] ${quote}`] }, trace(), { ...loaded, pages: [page1, sentence] }).status, 'fail');
  assert.equal(checkSourceCitations({ ...answer, citations: [`[source=handbook;edition=2026-2;pdf_page=2] ${quote}`] }, { ...trace(), calls: [] }, { ...loaded, pages: [page1, sentence] }).status, 'fail');
});

test('adapter applies source checks, preserves rejected answers, and never retries the model', async t => {
  const options = { model: 'pinned-test-model', budgetUsd: 0.1, traceTools: true, sourceContract: manifest };
  assert.throws(() => buildCommand({ ...options, traceTools: false }));
  for (const valid of [true, false]) {
    const cwd = await fixture(t);
    const output = valid ? answer : { ...answer, citations: [citation.replace('2026-2', '2026-1')] };
    let modelCalls = 0;
    const invocation = invokeClaude(request, options, { cwd, env: { ANTHROPIC_API_KEY: 'fixture-only' }, run: async (command) => {
      const version = command.includes('--version');
      if (!version) {
        modelCalls++;
        const prompt = command[command.indexOf('--append-system-prompt') + 1]!;
        assert.match(prompt, /Original-source verification/);
        assert(!prompt.includes('Students complete two distinct areas.'));
      }
      return { stdout: version ? '2.1.325' : stream(output), stderr: '', exitCode: 0, signal: null, timedOut: false, outputLimitExceeded: false } satisfies ProcessResult;
    } });
    if (valid) assert.deepEqual(await invocation, answer);
    else await assert.rejects(invocation, /source citation checks failed/);
    const check = JSON.parse(await readFile(path.join(cwd, 'source-check.json'), 'utf8'));
    assert.equal(check.status, valid ? 'pass' : 'fail');
    assert.equal(check.accepted_output, valid);
    assert.deepEqual(check.candidate_output, output);
    assert.equal(modelCalls, 1);
  }
});

test('invalid manifests and existing source-check files stop before a model call', async t => {
  const cwd = await fixture(t);
  const options = { model: 'pinned-test-model', budgetUsd: 0.1, traceTools: true, sourceContract: manifest };
  let modelCalls = 0;
  const run = async (command: readonly string[]): Promise<ProcessResult> => {
    if (!command.includes('--version')) modelCalls++;
    return { stdout: '2.1.325', stderr: '', exitCode: 0, signal: null, timedOut: false, outputLimitExceeded: false };
  };
  await assert.rejects(invokeClaude({ ...request, inputs: { policy_edition: 'other' } }, options, { cwd, env: {}, run }), /Source contract validation/);
  await writeFile(path.join(cwd, 'source-check.json'), 'keep');
  await assert.rejects(invokeClaude(request, options, { cwd, env: { ANTHROPIC_API_KEY: 'fixture-only' }, run }), /fresh source-check/);
  assert.equal(await readFile(path.join(cwd, 'source-check.json'), 'utf8'), 'keep');
  assert.equal(modelCalls, 0);
});
