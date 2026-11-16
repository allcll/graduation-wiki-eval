import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import { digest, parseJson } from '../json.js';
import type { AdapterAnswer, AdapterRequest } from './request.js';
import type { ClaudeToolTrace } from './claude-trace.js';
import { matchTableCitation, tableContradiction, normalizeQuote, type LoadedTableIndex } from './table-citations.js';
import { automaticStatus, type AutomaticCheck } from '../automatic-evaluation.js';

const token = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/);
const checksum = z.string().regex(/^sha256:[a-f0-9]{64}$/);
export const sourceContractSchema = z.strictObject({
  schema: z.literal('graduation-wiki-eval/source-contract-v1'),
  source_id: token,
  edition: token,
  pdf: z.strictObject({ path: z.string(), sha256: checksum, pages: z.number().int().positive().max(100_000) }),
  text: z.strictObject({ path: z.string(), sha256: checksum, format: z.literal('pdftotext-layout-formfeed') }),
});
export type SourceContract = z.infer<typeof sourceContractSchema>;
export interface LoadedSourceContract { contract: SourceContract; pages: readonly string[]; contract_sha256: string; tables?: LoadedTableIndex }
const hashBytes = (bytes: Buffer) => 'sha256:' + createHash('sha256').update(bytes).digest('hex');
// Fold paired quotation typography around words, not arbitrary punctuation.
// Apostrophes inside words, numeric quotes/primes, signs, decimals and ranges stay.
function normalizeCitationTypography(text: string): string {
  return text.normalize('NFC').replace(/[‘’]/gu, "'").replace(/[“”]/gu, '"')
    .replace(/(?<![\p{L}\p{N}_])(['"])([^'"\r\n]+)\1/gu,
      (whole: string, _mark: string, body: string) => /\p{L}/u.test(body) ? body : whole)
    .replace(/\s/gu, '');
}
type SourceReadTrace = Pick<ClaudeToolTrace, 'complete' | 'request_sha256'> & {
  calls: readonly Pick<ClaudeToolTrace['calls'][number], 'tool' | 'path' | 'status' | 'delivered_pages'>[];
};

/** The manifest is a trusted, reviewed source identity, not an oracle. Both
 * files and the manifest must be listed snapshots, so runner hashes bind them. */
export async function loadSourceContract(file: string, request: AdapterRequest, cwd: string): Promise<LoadedSourceContract> {
  if (!request.context.sources.includes(file)) throw new Error('Source contract must be a listed source file');
  const manifestBytes = await readFile(path.join(cwd, file));
  if (manifestBytes.length > 64 * 1024) throw new Error('Source contract exceeds 64 KiB');
  const contract = sourceContractSchema.parse(parseJson(manifestBytes.toString('utf8')));
  const editions = ['policy_edition', 'policy_term']
    .filter(key => Object.hasOwn(request.inputs, key)).map(key => request.inputs[key]);
  if (!editions.length || editions.some(edition => edition !== contract.edition)) {
    throw new Error('Source edition differs from inputs.policy_edition/policy_term');
  }
  if (new Set([file, contract.pdf.path, contract.text.path]).size !== 3 ||
      ![contract.pdf.path, contract.text.path].every(item => request.context.sources.includes(item))) {
    throw new Error('PDF and extracted text must be distinct listed source files');
  }
  const [pdf, text] = await Promise.all([readFile(path.join(cwd, contract.pdf.path)), readFile(path.join(cwd, contract.text.path))]);
  if (!pdf.subarray(0, 5).equals(Buffer.from('%PDF-')) || hashBytes(pdf) !== contract.pdf.sha256 || hashBytes(text) !== contract.text.sha256) {
    throw new Error('Original source checksum or PDF header mismatch');
  }
  const pages = text.toString('utf8').split('\f');
  if (pages.pop() !== '' || pages.length !== contract.pdf.pages) throw new Error('Extracted text must have one form feed per PDF page');
  return { contract, pages, contract_sha256: hashBytes(manifestBytes) };
}

export function sourceCitationInstructions(contract: SourceContract, indexedTables: readonly { id: string; pdf_page: number }[] = []): string {
  return `Original-source verification is enabled. The source catalog below identifies files, not answers.
Use the extracted text to find relevant sections, then use Read with the pages parameter on the PDF to inspect the relevant original page images before answering. PDF page numbers are 1-based document pages, not inferred printed page labels. Read only pages needed for this question; do not read the entire PDF.
Ground each policy claim in the requested edition, including target, exceptions, course classification and credits. WIKI and Skill are navigation/procedure documents, not substitutes for original evidence. Do not infer the application's internal failure cause without code or data.
Every citations entry must use exactly this format: [source=SOURCE_ID;edition=EDITION;pdf_page=N] SHORT_EXACT_QUOTE
Replace the placeholders with the catalog's source_id, edition, a page you actually read, and a quote from that page. Prose quotes must be verbatim contiguous text. ${indexedTables.length ? `Only these indexed tables support joined cell quotations: ${JSON.stringify(indexedTables.map(({ id, pdf_page }) => ({ id, pdf_page })))}. In those tables, use group + (item, value) pairs + optional complete shared qualifier; spaces or a single comma may separate complete cells. Preserve punctuation inside cells. Each item/value pair must come from the same row; the group and qualifier must span every cited row. Do not insert column headings, units absent from the cell, or explanations. Do not mix unrelated rows or columns. For all other tables, cite individual verbatim fragments separately and explain their relationships in answer_text.` : 'No table index is configured; cite individual verbatim text fragments instead of reconstructing table rows.'} Short cell values are allowed; quotes must be nonempty and at most 600 non-whitespace characters. Do not add quotation marks or paraphrase inside the quote. Include at least one entry, and enough entries to support the policy claims. A file name or edition label alone is insufficient. Do not put WIKI or Skill citations in this array.
Source catalog: ${JSON.stringify(contract)}
Passing the file/page/quote checks does not establish that a quote supports your interpretation; explain that reasoning in answer_text.`;
}

/** Checks provenance, literal text and indexed table-cell relationships. This does
 * not score entailment, scope, completeness, or policy interpretation. */
export function checkSourceCitations(answer: AdapterAnswer, trace: SourceReadTrace, loaded: LoadedSourceContract) {
  const { contract, pages } = loaded;
  const delivered = trace.calls.filter(call => call.tool === 'Read' && call.path === contract.pdf.path
    && call.status === 'success' && call.delivered_pages !== null).flatMap(call => {
    const range = call.delivered_pages!;
    return range.start + range.count - 1 <= contract.pdf.pages ? [range] : [];
  });
  const citations = answer.citations.map((citation, index) => {
    const match = /^\[source=([A-Za-z0-9._-]+);edition=([A-Za-z0-9._-]+);pdf_page=([1-9]\d*)\] ([\s\S]+)$/.exec(citation);
    const page = match ? Number(match[3]) : null;
    const quote = match?.[4] ?? '';
    const normalized = normalizeQuote(quote);
    const table = page !== null && loaded.tables ? matchTableCitation(quote, page, loaded.tables.index) : null;
    const literal = page !== null && page >= 1 && page <= pages.length && normalized.length > 0
      && normalizeQuote(pages[page - 1]!).includes(normalized);
    const typography = normalizeCitationTypography(quote);
    const normalizedMatch = page !== null && page >= 1 && page <= pages.length && typography.length > 0
      && normalizeCitationTypography(pages[page - 1]!).includes(typography);
    // A recognized table claim with contradictory relationships cannot escape
    // through a coincidental match in flattened page text.
    const located = table && table.status !== 'not_applicable' ? table.status === 'matched' : literal || normalizedMatch;
    const checks = {
      format: match !== null,
      source: match?.[1] === contract.source_id,
      edition: match?.[2] === contract.edition,
      page_exists: page !== null && Number.isSafeInteger(page) && page <= pages.length,
      page_read: page !== null && delivered.some(range => page >= range.start && page < range.start + range.count),
      quote_nonempty: normalized.length > 0,
      quote_within_limit: [...normalized].length <= 600,
      quote_grounded: located,
    };
    const issues: AutomaticCheck[] = [];
    const issue = (code: string, verdict: AutomaticCheck['verdict'], reason: string, next_action: string) =>
      issues.push({ id: `citation_${index}:${code}`, verdict, reason, next_action });
    if (!checks.format) issue('format', 'fail', '인용 메타데이터 형식이 올바르지 않습니다.', '출처·판본·페이지 형식을 확인하세요. 파싱 실패를 별도의 판본 오류로 중복 집계하지 않습니다.');
    else {
      for (const [key, reason] of Object.entries({ source: '지정한 원문 출처와 다릅니다.', edition: '요청한 편람 판본과 다릅니다.',
        page_exists: '원본 PDF에 없는 페이지입니다.', quote_nonempty: '인용문이 비어 있습니다.', quote_within_limit: '인용문이 600자를 초과합니다.' })) {
        if (!checks[key as keyof typeof checks]) issue(key, 'fail', reason, '해당 인용과 지정한 원문 정보를 대조하세요.');
      }
      if (checks.page_exists && !checks.page_read) issue('page_read', 'fail', '인용한 PDF 페이지가 전달된 기록이 없습니다.', '문구의 정확성과 원본 페이지 확인 절차를 구분해 검토하세요.');
      if (checks.source && checks.edition && checks.page_exists && checks.quote_nonempty && checks.quote_within_limit && !located) {
        const conflict = loaded.tables && page !== null ? tableContradiction(quote, page, loaded.tables.index) : null;
        if (conflict) issue('table_conflict', 'fail', `색인된 표의 행·열 관계와 충돌합니다: ${conflict}`, '같은 행의 과목·학점과 병합셀의 영역·제외계열을 대조하세요.');
        else issue('quote_unverified', 'inconclusive', '문구나 표 관계를 현재 검사 범위에서 확인하지 못했습니다. 내용 오류로 확정한 결과가 아닙니다.', '원문 페이지와 인용을 대조해 오타·설명 혼합·미지원 표를 구분하세요. 확인 전에는 통과로 세지 않습니다.');
      }
    }
    return { index, pdf_page: page !== null && Number.isSafeInteger(page) ? page : null,
      quote_sha256: match ? digest(quote) : null, literal_match: literal, normalized_match: normalizedMatch,
      match_basis: table?.status === 'matched' ? 'table_cells' as const : located && literal ? 'literal_text' as const
        : located && normalizedMatch ? 'normalized_text' as const : 'none' as const,
      table_match: table, checks, passed: Object.values(checks).every(Boolean), verdict: automaticStatus(issues), issues };
  });
  const failures = [
    ...(!trace.complete ? ['incomplete_tool_trace'] : []),
    ...(!delivered.length ? ['original_pdf_not_read'] : []),
    ...(!citations.length ? ['missing_original_citation'] : []),
    ...citations.flatMap(citation => Object.entries(citation.checks).filter(([, ok]) => !ok).map(([key]) => `citation_${citation.index}:${key}`)),
  ];
  const issues: AutomaticCheck[] = [
    ...(!trace.complete ? [{ id: 'incomplete_tool_trace', verdict: 'fail' as const, reason: '도구 기록이 불완전합니다.', next_action: '실행 기록을 확인하세요.' }] : []),
    ...(!delivered.length ? [{ id: 'original_pdf_not_read', verdict: 'fail' as const, reason: '원본 PDF 페이지 전달 기록이 없습니다.', next_action: '원문 확인 절차를 검토하세요.' }] : []),
    ...(!citations.length ? [{ id: 'missing_original_citation', verdict: 'fail' as const, reason: '원문 인용이 없습니다.', next_action: '주장을 뒷받침할 편람 근거를 확인하세요.' }] : []),
    ...citations.flatMap(citation => citation.issues),
  ];
  return {
    schema: 'graduation-wiki-eval/source-check-v3' as const,
    checker_version: 'citation-verdict-4' as const,
    status: automaticStatus(issues), issues,
    legacy_status: failures.length === 0 ? 'pass' as const : 'fail' as const,
    request_sha256: trace.request_sha256, output_sha256: digest(answer),
    contract_sha256: loaded.contract_sha256, source_id: contract.source_id, edition: contract.edition,
    pdf_sha256: contract.pdf.sha256, text_sha256: contract.text.sha256,
    table_index_sha256: loaded.tables?.sha256 ?? null,
    delivered_pdf_pages: delivered, citations, failures,
    semantic_support: 'requires_review' as const,
    note: 'Checks pinned source identity, delivered pages, literal text or indexed table-cell relationships. Does not establish policy applicability, complete evidence, or a correct answer. Unindexed tables have no cell-relationship verification.',
  };
}
export type SourceCitationCheck = ReturnType<typeof checkSourceCitations>;
