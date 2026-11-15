import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { digest, parseJson } from '../src/json.js';
import { loadTableIndex, matchTableCitation, tableIndexSchema } from '../src/adapters/table-citations.js';
import { checkSourceCitations, type LoadedSourceContract } from '../src/adapters/source-citations.js';

const fixture = new URL('../datasets/graduation-2026-2/source-indexes/handbook-2026-2-p53.tables.json', import.meta.url);
const sourceIndex = tableIndexSchema.parse(parseJson(await readFile(fixture, 'utf8')));
const quotations = [
  '자연과과학 현대과학으로의초대 3 자연과학, 생명과학 전자정보공학 소프트웨어융합, 공과',
  '문화와예술 한국의문화와한류 3 현대예술의이해 3 예체능',
  '경제와사회 경영학 3 사회과학 경영경제 호텔관광',
];

test('saved table quotes resolve through source rows and merged-cell spans', () => {
  const expectedRows = [[8], [15, 16], [9]];
  quotations.forEach((quote, i) => {
    const match = matchTableCitation(quote, 53, sourceIndex);
    assert.equal(match.status, 'matched');
    assert.deepEqual(match.matches[0]?.rows, expectedRows[i]);
    assert.equal(match.matches[0]?.table_id, 'p53-balance-2022');
  });
  assert.equal(matchTableCitation('학점 합계 6', 53, sourceIndex).status, 'not_applicable');
  assert.equal(matchTableCitation(quotations[0]!, 52, sourceIndex).status, 'not_applicable');
});

test('commas separate complete indexed cells, without changing row relationships or cell contents', () => {
  for (const quote of [
    '역사와사상, 한국현대사, 3',
    '자연과과학, 현대과학으로의초대, 3, 자연과학, 생명과학 전자정보공학 소프트웨어융합, 공과',
    '문화와예술, 한국의문화와한류, 3, 현대예술의이해, 3, 예체능',
  ]) assert.equal(matchTableCitation(quote, 53, sourceIndex).status, 'matched', quote);
  for (const quote of [
    '역사와사상, 한국현대사, 4', '문화와예술, 한국현대사, 3',
    '자연과과학, 현대과학으로의초대, 3, 예체능',
    '경제와사회, 경영학, 3, 호텔관광',
    '자연과과학, 현대과학으로의초대, 3, 자연과학 생명과학 전자정보공학 소프트웨어융합 공과',
    '역사와사상, 한국현대사, 3.0', '역사와사상, 한국현대사, -3',
    '역사와사상, 한국현대사, 3,0', '역사와사상, 한국현대사, 3-4',
    '역사와사상, 한국현대사, 3,', '역사와사상, 한국현대사, 3, 설명 추가',
  ]) assert.equal(matchTableCitation(quote, 53, sourceIndex).status, 'conflict', quote);
  assert.equal(matchTableCitation('역사와사상, 한국현대사, 3', 48, sourceIndex).status, 'not_applicable');
});

test('words on the same page do not permit wrong group, value or qualifier relationships', () => {
  for (const quote of [
    '문화와예술 현대과학으로의초대 3 예체능',
    '자연과과학 현대과학으로의초대 6',
    '자연과과학 현대과학으로의초대 3 예체능',
    '문화와예술 한국의문화와한류 3 현대과학으로의초대 3 예체능',
    '경제와사회 경영학 3 인문과학',
    '경제와사회 경영학 3 호텔관광', // only part of the shared qualifier cell
    '문화와예술 한국의문화와한류 3 현대예술의이해 6 예체능',
    quotations[0] + ' invented text',
  ]) assert.equal(matchTableCitation(quote, 53, sourceIndex).status, 'conflict', quote);
});

test('same-row values matter even when both candidate values occur inside one group', () => {
  const index = structuredClone(sourceIndex);
  index.tables[0]!.cells.find(cell => cell.id === 'r16c2')!.text = '2';
  assert.equal(matchTableCitation('문화와예술 한국의문화와한류 3 현대예술의이해 2 예체능', 53, index).status, 'matched');
  assert.equal(matchTableCitation('문화와예술 한국의문화와한류 2 현대예술의이해 3 예체능', 53, index).status, 'conflict');
});

test('ambiguous tables and malformed geometry never become unique supporting evidence', () => {
  const index = structuredClone(sourceIndex);
  index.tables.push({ ...structuredClone(index.tables[0]!), id: 'another-table' });
  assert.equal(matchTableCitation(quotations[0]!, 53, index).status, 'ambiguous');
  for (const mutate of [
    (data: typeof index) => { data.tables[0]!.cells.pop(); },
    (data: typeof index) => { data.tables[0]!.cells.push(structuredClone(data.tables[0]!.cells[0]!)); },
    (data: typeof index) => { data.tables[0]!.cells.find(cell => cell.id === 'r5c0')!.row_span = 8; },
    (data: typeof index) => { data.tables[0]!.layout.item_column = data.tables[0]!.layout.group_column; },
  ]) {
    const changed = structuredClone(sourceIndex); mutate(changed);
    assert.equal(tableIndexSchema.safeParse(changed).success, false);
  }
});

test('a table contradiction overrides an accidental flattened-text match', () => {
  for (const wrong of ['문화와예술 현대과학으로의초대 3 예체능', '문화와예술, 현대과학으로의초대, 3, 예체능']) {
  const loaded: LoadedSourceContract = { contract: { schema: 'graduation-wiki-eval/source-contract-v1', source_id: sourceIndex.source_id,
    edition: sourceIndex.edition, pdf: { path: 'context/sources/source.pdf', pages: 53, sha256: sourceIndex.pdf_sha256 },
    text: { path: 'context/sources/source.txt', sha256: sourceIndex.pdf_sha256, format: 'pdftotext-layout-formfeed' } },
    contract_sha256: sourceIndex.pdf_sha256, pages: [...Array<string>(52).fill(''), wrong], tables: { index: sourceIndex, sha256: digest(sourceIndex) } };
  const result = checkSourceCitations({ action: 'answer', answer_text: 'fixture', facts: {}, citations: [`[source=${sourceIndex.source_id};edition=2026-2;pdf_page=53] ${wrong}`] },
    { complete: true, request_sha256: sourceIndex.pdf_sha256, calls: [{ tool: 'Read', path: loaded.contract.pdf.path, status: 'success', delivered_pages: { start: 53, count: 1 } }] }, loaded);
  assert.equal(result.citations[0]?.literal_match, true);
  assert.equal(result.status, 'fail');
  }
});

test('table assets must match source edition, PDF hash, page and extracted cell text', async t => {
  const cwd = await mkdtemp(path.join(tmpdir(), 'table-index-'));
  t.after(async () => rm(cwd, { recursive: true, force: true }));
  await mkdir(path.join(cwd, 'data'));
  const file = path.join(cwd, 'data/tables.json');
  await writeFile(file, JSON.stringify(sourceIndex));
  const source = { source_id: sourceIndex.source_id, edition: sourceIndex.edition, pdf: { sha256: sourceIndex.pdf_sha256 } };
  const pages = [...Array<string>(52).fill(''), sourceIndex.tables[0]!.cells.map(cell => cell.text).join('\n')];
  assert.equal((await loadTableIndex(file, source, pages)).index.tables.length, 1);
  await assert.rejects(loadTableIndex(file, { ...source, edition: '2026-1' }, pages), /pinned source/);
  await assert.rejects(loadTableIndex(file, { ...source, pdf: { sha256: 'sha256:' + '0'.repeat(64) } }, pages), /pinned source/);
  await assert.rejects(loadTableIndex(file, source, pages.slice(0, 52)), /outside source/);
  await assert.rejects(loadTableIndex(file, source, Array<string>(53).fill('not the cell text')), /missing/);
});
