import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseJson } from '../src/json.js';
import { writeOracleHtml } from '../src/oracle-html.js';
import { createOracleWorkspace, updateOracleEntry, validateOracleWorkspace } from '../src/oracle-review.js';
import { caseSchema, parseCases, type Case } from '../src/schema.js';

function fixture(): Case[] {
  return parseCases([{
    id: 'html-test', family: 'fictional', split: 'dev', origin: 'synthetic',
    review_status: 'draft', independent_reference: true,
    question: '가상 질문', expected: { action: 'answer', facts: { credits: 3 } },
    rubric: { version: 'fictional-v1', criteria: [
      { id: 'answer', dimension: 'answer', severity: 'major', description: '가상 답변 기준' },
      { id: 'evidence', dimension: 'evidence', severity: 'major', description: '가상 근거 기준' },
    ] },
    sources: [{ id: 'fictional-source', version: 'fictional-v1', locator: '가상 편람 p.1', excerpt: '소프트웨어 테스트용 원문', authoritative: false }],
  }]);
}

function payload(html: string): { workspace: unknown; sourceLinks: Record<string, string>; sourceLinkTargets: Record<string, Case['sources']> } {
  const match = /<script type="application\/json" id="oracle-data">([\s\S]*?)<\/script>/.exec(html);
  assert.ok(match?.[1]);
  const value = parseJson(match[1]);
  assert.ok(value && typeof value === 'object' && !Array.isArray(value));
  const links = value['sourceLinks'];
  assert.ok(links && typeof links === 'object' && !Array.isArray(links));
  const sourceLinks: Record<string, string> = {};
  for (const [key, href] of Object.entries(links)) { assert.ok(typeof href === 'string'); sourceLinks[key] = href; }
  const targets = value['sourceLinkTargets'];
  assert.ok(targets && typeof targets === 'object' && !Array.isArray(targets));
  const sourceLinkTargets = Object.fromEntries(Object.entries(targets).map(([key, sources]) => [key, caseSchema.shape.sources.parse(sources)]));
  return { workspace: value['workspace'], sourceLinks, sourceLinkTargets };
}

test('HTML escapes case/title content and hashes the exact embedded script and style for CSP', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'grad-oracle-html-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const cases = fixture(); const first = cases[0]; assert.ok(first);
  first.question = '</script><img src=x onerror=alert(1)> & \u2028\u2029';
  first.expected.facts['hostile'] = '</script><script>window.injected=true</script>';
  const result = await writeOracleHtml(cases, { out: join(directory, 'review.html'), title: '<검토> & "정답"' });
  assert.equal(result.cases, 1); assert.equal(result.approved, 0);
  const html = await readFile(result.path, 'utf8');
  assert.match(html, /<title>&lt;검토&gt; &amp; &quot;정답&quot;<\/title>/);
  assert.doesNotMatch(html, /<img src=x/);
  assert.doesNotMatch(html, /<script>window.injected/);
  const restored = await validateOracleWorkspace(payload(html).workspace, cases);
  assert.equal(restored.entries[0]?.draft.question, first.question);
  assert.equal((html.match(/<script(?:\s|>)/g) ?? []).length, 2);
  assert.match(html, /\\u2028\\u2029/);
  const script = /<script>([\s\S]*?)<\/script>/.exec(html)?.[1];
  const style = /<style>([\s\S]*?)<\/style>/.exec(html)?.[1];
  assert.ok(script && style);
  const sha = (value: string): string => createHash('sha256').update(value).digest('base64');
  assert.ok(html.includes(`script-src 'sha256-${sha(script)}'`));
  assert.ok(html.includes(`style-src 'sha256-${sha(style)}'`));
  assert.match(html, /connect-src 'none'/);
  assert.match(html, /base-uri 'none'/);
  assert.doesNotMatch(html, /unsafe-inline|<script[^>]*\ssrc=/);
});

test('source links support explicit web sources and local PDF page links relative to the mapping file', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'grad-oracle-link-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const pdf = pathToFileURL(join(directory, 'sources', '수강 편람.pdf'));
  pdf.hash = '#page=4';
  const local = await writeOracleHtml(fixture(), {
    out: join(directory, 'local.html'), sourceLinks: { 'fictional-source': 'sources/수강 편람.pdf#page=4' }, sourceLinksBase: directory,
  });
  assert.equal(payload(await readFile(local.path, 'utf8')).sourceLinks['fictional-source'], pdf.href);
  for (const [index, href] of ['https://example.com/handbook?q=one#chapter', 'http://example.com/reference', pdf.href].entries()) {
    const output = await writeOracleHtml(fixture(), { out: join(directory, `link-${index}.html`), sourceLinks: { 'fictional-source': href } });
    assert.equal(payload(await readFile(output.path, 'utf8')).sourceLinks['fictional-source'], href);
  }
});

test('unsupported links and unknown source ids fail before creating the output file', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'grad-oracle-reject-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const invalid = [
    'javascript:alert(1)', 'data:text/html,test', 'ftp://example.com/book.pdf',
    'https://name:password@example.com/book.pdf', 'file://remote-host/book.pdf',
    'source.html', 'file:///tmp/source.js', 'file:///tmp/book.pdf?download=1',
    'book.pdf#page=0', 'book.pdf#page=-1', 'book.pdf#page=1.5', 'book.pdf#section=1', ' ',
  ];
  for (const [index, href] of invalid.entries()) {
    const out = join(directory, `invalid-${index}.html`);
    await assert.rejects(writeOracleHtml(fixture(), { out, sourceLinks: { 'fictional-source': href } }));
    await assert.rejects(readFile(out), /ENOENT/);
  }
  const unknown = join(directory, 'unknown.html');
  await assert.rejects(writeOracleHtml(fixture(), { out: unknown, sourceLinks: { absent: 'https://example.com' } }), /평가셋에 없는 출처/);
  await assert.rejects(readFile(unknown), /ENOENT/);
  await assert.rejects(writeOracleHtml(fixture(), { out: join(directory, 'wrong.txt') }), /\.html/);
});

test('resuming preserves review state while stale work and existing output are rejected', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'grad-oracle-resume-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const cases = fixture();
  let workspace = await createOracleWorkspace(cases);
  workspace = await updateOracleEntry(workspace, 'html-test', { reviewer: 'software-test-only', note: '저장 테스트', status: 'approved' });
  const output = await writeOracleHtml(cases, { out: join(directory, 'resume.html'), workspace });
  assert.equal(output.approved, 1);
  const restored = await validateOracleWorkspace(payload(await readFile(output.path, 'utf8')).workspace, cases);
  assert.deepEqual(restored, workspace);

  const previous = await readFile(output.path, 'utf8');
  await assert.rejects(writeOracleHtml(cases, { out: output.path }), /EEXIST/);
  assert.equal(await readFile(output.path, 'utf8'), previous);
  const changedCases = fixture(); const first = changedCases[0]; assert.ok(first);
  first.question = '수정한 원본 질문';
  const stale = join(directory, 'stale.html');
  await assert.rejects(writeOracleHtml(changedCases, { out: stale, workspace }), /다른 평가셋/);
  await assert.rejects(readFile(stale), /ENOENT/);
  const protectedInput = join(directory, 'input.html');
  await writeFile(protectedInput, 'preserve this file');
  await assert.rejects(writeOracleHtml(cases, { out: protectedInput }), /EEXIST/);
  assert.equal(await readFile(protectedInput, 'utf8'), 'preserve this file');
});

test('regenerated HTML binds new links to edited evidence without changing the original source snapshot', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'grad-oracle-relink-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const cases = fixture(); const first = cases[0]; assert.ok(first);
  let workspace = await createOracleWorkspace(cases);
  const original = await writeOracleHtml(cases, {
    out: join(directory, 'before.html'), sourceLinks: { 'fictional-source': 'https://example.com/old.pdf' },
  });
  const before = payload(await readFile(original.path, 'utf8'));
  assert.deepEqual(before.sourceLinkTargets, { 'html-test': first.sources });

  const record = workspace.entries[0]; assert.ok(record);
  const draft = structuredClone(record.draft);
  draft.sources = [{ id: 'revised-source', version: 'fictional-v2', locator: '가상 편람 p.2', excerpt: '수정한 테스트용 원문', authoritative: false }];
  workspace = await updateOracleEntry(workspace, 'html-test', { draft });
  const regenerated = await writeOracleHtml(cases, {
    out: join(directory, 'after.html'), workspace,
    sourceLinks: { 'revised-source': 'https://example.com/new.pdf#page=2' },
  });
  const after = payload(await readFile(regenerated.path, 'utf8'));
  assert.deepEqual(after.sourceLinkTargets, { 'html-test': draft.sources });
  assert.equal(after.sourceLinks['revised-source'], 'https://example.com/new.pdf#page=2');
  assert.notDeepEqual(after.sourceLinkTargets, before.sourceLinkTargets);
  const restored = await validateOracleWorkspace(after.workspace, cases);
  assert.deepEqual(restored.entries[0]?.source.sources, first.sources);
  assert.deepEqual(restored.entries[0]?.draft.sources, draft.sources);
  await assert.rejects(writeOracleHtml(cases, {
    out: join(directory, 'stale-link.html'), workspace, sourceLinks: { 'fictional-source': 'https://example.com/old.pdf' },
  }), /평가셋에 없는 출처/);
});
