import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import { digest, parseJson } from '../json.js';
import type { AdapterAnswer, AdapterRequest } from './request.js';
import type { ClaudeToolTrace } from './claude-trace.js';

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
export interface LoadedSourceContract { contract: SourceContract; pages: readonly string[]; contract_sha256: string }
const hashBytes = (bytes: Buffer) => 'sha256:' + createHash('sha256').update(bytes).digest('hex');
const normalize = (text: string) => text.normalize('NFC').replace(/\s/gu, '');

/** The manifest is a trusted, reviewed source identity, not an oracle. Both
 * files and the manifest must be listed snapshots, so runner hashes bind them. */
export async function loadSourceContract(file: string, request: AdapterRequest, cwd: string): Promise<LoadedSourceContract> {
  if (!request.context.sources.includes(file)) throw new Error('Source contract must be a listed source file');
  const manifestBytes = await readFile(path.join(cwd, file));
  if (manifestBytes.length > 64 * 1024) throw new Error('Source contract exceeds 64 KiB');
  const contract = sourceContractSchema.parse(parseJson(manifestBytes.toString('utf8')));
  if (request.inputs['policy_edition'] !== contract.edition) throw new Error('Source edition differs from inputs.policy_edition');
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

export function sourceCitationInstructions(contract: SourceContract): string {
  return `Original-source verification is enabled. The source catalog below identifies files, not answers.
Use the extracted text to find relevant sections, then use Read with the pages parameter on the PDF to inspect the relevant original page images before answering. PDF page numbers are 1-based document pages, not inferred printed page labels. Read only pages needed for this question; do not read the entire PDF.
Ground each policy claim in the requested edition, including target, exceptions, course classification and credits. WIKI and Skill are navigation/procedure documents, not substitutes for original evidence. Do not infer the application's internal failure cause without code or data.
Every citations entry must use exactly this format: [source=SOURCE_ID;edition=EDITION;pdf_page=N] SHORT_EXACT_QUOTE
Replace the placeholders with the catalog's source_id, edition, a page you actually read, and a verbatim contiguous quote from that page's extracted text. Keep each quote between 8 and 600 non-whitespace characters. Do not add quotation marks or paraphrase inside the quote. Include at least one entry, and enough entries to support the policy claims. The quote must occur on that same page; a file name or an edition label alone is insufficient. Do not put WIKI or Skill citations in this array.
Source catalog: ${JSON.stringify(contract)}
Passing the file/page/quote checks does not establish that a quote supports your interpretation; explain that reasoning in answer_text.`;
}

/** Checks provenance and literal citation location only. This deliberately does
 * not score entailment, scope, completeness, or policy interpretation. */
export function checkSourceCitations(answer: AdapterAnswer, trace: ClaudeToolTrace, loaded: LoadedSourceContract) {
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
    const normalized = normalize(quote);
    const checks = {
      format: match !== null,
      source: match?.[1] === contract.source_id,
      edition: match?.[2] === contract.edition,
      page_exists: page !== null && Number.isSafeInteger(page) && page <= pages.length,
      page_read: page !== null && delivered.some(range => page >= range.start && page < range.start + range.count),
      quote_length: [...normalized].length >= 8 && [...normalized].length <= 600,
      quote_on_page: page !== null && page >= 1 && page <= pages.length && normalized.length > 0
        && normalize(pages[page - 1]!).includes(normalized),
    };
    return { index, pdf_page: page !== null && Number.isSafeInteger(page) ? page : null,
      quote_sha256: match ? digest(quote) : null, checks, passed: Object.values(checks).every(Boolean) };
  });
  const failures = [
    ...(!trace.complete ? ['incomplete_tool_trace'] : []),
    ...(!delivered.length ? ['original_pdf_not_read'] : []),
    ...(!citations.length ? ['missing_original_citation'] : []),
    ...citations.flatMap(citation => Object.entries(citation.checks).filter(([, ok]) => !ok).map(([key]) => `citation_${citation.index}:${key}`)),
  ];
  return {
    schema: 'graduation-wiki-eval/source-check-v1' as const,
    status: failures.length === 0 ? 'pass' as const : 'fail' as const,
    request_sha256: trace.request_sha256, output_sha256: digest(answer),
    contract_sha256: loaded.contract_sha256, source_id: contract.source_id, edition: contract.edition,
    pdf_sha256: contract.pdf.sha256, text_sha256: contract.text.sha256,
    delivered_pdf_pages: delivered, citations, failures,
    semantic_support: 'requires_review' as const,
    note: 'Checks pinned source identity, delivered PDF pages and verbatim quote location. Does not establish semantic support, complete evidence, or a correct answer.',
  };
}
export type SourceCitationCheck = ReturnType<typeof checkSourceCitations>;
