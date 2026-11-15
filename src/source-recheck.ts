import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import { digest, parseJson } from './json.js';
import { answerSchema, validateRequest } from './adapters/request.js';
import { checkSourceCitations, loadSourceContract } from './adapters/source-citations.js';
import { loadTableIndex } from './adapters/table-citations.js';

const sha = z.string().regex(/^sha256:[a-f0-9]{64}$/);
const traceSchema = z.looseObject({
  schema: z.literal('graduation-wiki-eval/claude-tools-v1'), request_sha256: sha, complete: z.literal(true),
  process: z.looseObject({ exit_code: z.literal(0), timed_out: z.literal(false), output_limit_exceeded: z.literal(false) }),
  calls: z.array(z.looseObject({ tool: z.enum(['Read', 'Grep', 'Glob', 'other']), path: z.string().nullable(),
    status: z.enum(['pending', 'success', 'error', 'conflict']),
    delivered_pages: z.strictObject({ start: z.number().int().positive(), count: z.number().int().positive() }).nullable() })),
});
const previousSchema = z.looseObject({
  schema: z.enum(['graduation-wiki-eval/source-check-v1', 'graduation-wiki-eval/source-check-v2']),
  status: z.enum(['pass', 'fail']), request_sha256: sha, output_sha256: sha, contract_sha256: sha,
  pdf_sha256: sha, text_sha256: sha, source_id: z.string(), edition: z.string(), candidate_output: answerSchema,
});
const fileHash = (bytes: Buffer) => 'sha256:' + createHash('sha256').update(bytes).digest('hex');

/** Rejudge a saved answer only. No model import, authentication or invocation.
 * Original request, trace, failed check, runs and reports remain untouched. */
export async function recheckSourceCitations(job: string, contractFile: string, tableIndex: string | undefined, out: string) {
  const cwd = path.resolve(job);
  const names = ['request.json', 'claude-tools.json', 'source-check.json'] as const;
  const bytes = await Promise.all(names.map(name => readFile(path.join(cwd, name))));
  const request = await validateRequest(parseJson(bytes[0]!.toString('utf8')), cwd);
  const trace = traceSchema.parse(parseJson(bytes[1]!.toString('utf8')));
  const previous = previousSchema.parse(parseJson(bytes[2]!.toString('utf8')));
  const source = await loadSourceContract(contractFile, request, cwd);
  if (trace.request_sha256 !== digest(request) || previous.request_sha256 !== digest(request)
      || previous.output_sha256 !== digest(previous.candidate_output)
      || previous.contract_sha256 !== source.contract_sha256 || previous.pdf_sha256 !== source.contract.pdf.sha256
      || previous.text_sha256 !== source.contract.text.sha256 || previous.edition !== source.contract.edition
      || previous.source_id !== source.contract.source_id) throw new Error('Saved request, answer, trace and source hashes do not agree');
  if (tableIndex) source.tables = await loadTableIndex(path.resolve(tableIndex), source.contract, source.pages);
  const result = {
    schema: 'graduation-wiki-eval/source-recheck-v1', mode: 'offline_recheck', model_calls: 0,
    case_id: request.case_id, condition: request.condition,
    input_files: Object.fromEntries(names.map((name, i) => [name, fileHash(bytes[i]!)])),
    previous_status: previous.status, source_check: checkSourceCitations(previous.candidate_output, trace, source),
    original_run_and_report_unchanged: true, human_review: 'pending',
  };
  await mkdir(path.dirname(path.resolve(out)), { recursive: true });
  await writeFile(out, JSON.stringify(result, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
  return result;
}
