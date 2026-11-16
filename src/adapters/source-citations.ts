import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import { digest, parseJson } from '../json.js';
import type { AdapterAnswer, AdapterRequest } from './request.js';
import type { ClaudeToolTrace } from './claude-trace.js';
import { matchTableCitation, normalizeQuote, type LoadedTableIndex } from './table-citations.js';

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

export function sourceCitationInstructions(contract: SourceContract, indexedTables = false): string {
  return `Original-source verification is enabled. The source catalog below identifies files, not answers.
Use the extracted text to find relevant sections, then use Read with the pages parameter on the PDF to inspect the relevant original page images before answering. PDF page numbers are 1-based document pages, not inferred printed page labels. Read only pages needed for this question; do not read the entire PDF.
Ground each policy claim in the requested edition, including target, exceptions, course classification and credits. WIKI and Skill are navigation/procedure documents, not substitutes for original evidence. Do not infer the application's internal failure cause without code or data.
Every citations entry must use exactly this format: [source=SOURCE_ID;edition=EDITION;pdf_page=N] SHORT_EXACT_QUOTE
Replace the placeholders with the catalog's source_id, edition, a page you actually read, and a quote from that page. Prose quotes must be verbatim contiguous text. ${indexedTables ? 'Table quotes may join exact cell values as: group, item and value pairs, then an optional shared qualifier. Each item/value pair must come from the same row; the group and any shared qualifier must span every cited row. Do not mix unrelated rows or columns.' : 'No table index is configured; cite individual verbatim text fragments instead of reconstructing table rows.'} Short cell values are allowed; quotes must be nonempty and at most 600 non-whitespace characters. Do not add quotation marks or paraphrase inside the quote. Include at least one entry, and enough entries to support the policy claims. A file name or edition label alone is insufficient. Do not put WIKI or Skill citations in this array.
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
    // A recognized table claim with contradictory relationships cannot escape
    // through a coincidental match in flattened page text.
    const located = table && table.status !== 'not_applicable' ? table.status === 'matched' : literal;
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
    return { index, pdf_page: page !== null && Number.isSafeInteger(page) ? page : null,
      quote_sha256: match ? digest(quote) : null, literal_match: literal,
      match_basis: table?.status === 'matched' ? 'table_cells' as const : located ? 'literal_text' as const : 'none' as const,
      table_match: table, checks, passed: Object.values(checks).every(Boolean) };
  });
  const failures = [
    ...(!trace.complete ? ['incomplete_tool_trace'] : []),
    ...(!delivered.length ? ['original_pdf_not_read'] : []),
    ...(!citations.length ? ['missing_original_citation'] : []),
    ...citations.flatMap(citation => Object.entries(citation.checks).filter(([, ok]) => !ok).map(([key]) => `citation_${citation.index}:${key}`)),
  ];
  return {
    schema: 'graduation-wiki-eval/source-check-v2' as const,
    status: failures.length === 0 ? 'pass' as const : 'fail' as const,
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
