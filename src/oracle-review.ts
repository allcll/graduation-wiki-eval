import { z } from 'zod';
import { assertJson, canonical } from './json-data.js';
import { caseSchema, parseCases, type Case } from './schema.js';

export const ORACLE_REVIEW_SCHEMA = 'graduation-wiki-eval/oracle-review-v1';
export const oracleStatusSchema = z.enum(['pending', 'needs_changes', 'on_hold', 'approved']);
const hashSchema = z.string().regex(/^sha256:[0-9a-f]{64}$/);
const nonblank = z.string().refine(value => Boolean(value.trim()), 'Must not be blank');
const timestampSchema = z.string().datetime();

const oracleEntrySchema = z.strictObject({
  source: caseSchema,
  source_sha256: hashSchema,
  draft: caseSchema,
  status: oracleStatusSchema,
  reviewer: z.string(),
  note: z.string(),
  reviewed_at: timestampSchema.nullable(),
  approved_sha256: hashSchema.nullable(),
});
const oracleWorkspaceSchema = z.strictObject({
  schema: z.literal(ORACLE_REVIEW_SCHEMA),
  title: nonblank,
  dataset_sha256: hashSchema,
  selected_case_id: nonblank,
  entries: z.array(oracleEntrySchema).min(1),
});
const oracleEntryPatchSchema = z.strictObject({
  draft: caseSchema.optional(),
  reviewer: z.string().optional(),
  note: z.string().optional(),
  status: oracleStatusSchema.optional(),
});

export type OracleStatus = z.infer<typeof oracleStatusSchema>;
export type OracleEntry = z.infer<typeof oracleEntrySchema>;
export type OracleWorkspace = z.infer<typeof oracleWorkspaceSchema>;
export type OracleEntryPatch = z.infer<typeof oracleEntryPatchSchema>;

function ensure(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

/** Same canonical JSON as the CLI digest, using the browser/Node Web Crypto API. */
async function hash(value: unknown): Promise<string> {
  assertJson(value);
  ensure(globalThis.crypto?.subtle, '검토 파일 확인에 Web Crypto가 필요합니다. 최신 브라우저에서 파일을 다시 열어 주세요.');
  const bytes = new TextEncoder().encode(canonical(value));
  const result = await globalThis.crypto.subtle.digest('SHA-256', bytes);
  return 'sha256:' + Array.from(new Uint8Array(result), byte => byte.toString(16).padStart(2, '0')).join('');
}

async function datasetHash(cases: Case[]): Promise<string> {
  return hash([...cases].sort((left, right) => left.id < right.id ? -1 : left.id > right.id ? 1 : 0));
}

function approvalContent(entry: OracleEntry): unknown {
  return { draft: entry.draft, reviewer: entry.reviewer, note: entry.note };
}

const fixedFields = ['id', 'family', 'split', 'origin', 'independent_reference'] as const;
function validateDraft(entry: OracleEntry): void {
  for (const field of fixedFields) {
    ensure(entry.draft[field] === entry.source[field], `검토 중에는 ${field}를 변경할 수 없습니다: ${entry.source.id}`);
  }
  ensure(entry.draft.review_status === 'draft' && entry.draft.oracle_reviewer === null,
    `검토 초안의 승인 정보는 내보내기에서만 지정합니다: ${entry.source.id}`);
}

/** Every new workspace starts a fresh human review, including previously verified inputs. */
export async function createOracleWorkspace(casesInput: unknown, title = '졸업요건 정답지 검토'): Promise<OracleWorkspace> {
  const cases = parseCases(casesInput);
  const entries = await Promise.all(cases.map(async (source): Promise<OracleEntry> => ({
    source,
    source_sha256: await hash(source),
    draft: { ...structuredClone(source), review_status: 'draft', oracle_reviewer: null },
    status: 'pending', reviewer: '', note: '', reviewed_at: null, approved_sha256: null,
  })));
  const first = entries[0];
  ensure(first, '검토할 문항이 없습니다.');
  return validateOracleWorkspace({
    schema: ORACLE_REVIEW_SCHEMA, title,
    dataset_sha256: await datasetHash(cases), selected_case_id: first.source.id, entries,
  }, cases);
}

/** Hashes bind saved work to its original dataset; they are not identity signatures. */
export async function validateOracleWorkspace(value: unknown, casesInput?: unknown): Promise<OracleWorkspace> {
  // Reject non-JSON values before Zod can strip or normalize them.
  assertJson(value);
  const workspace = oracleWorkspaceSchema.parse(value);
  const sources = parseCases(workspace.entries.map(entry => entry.source));
  parseCases(workspace.entries.map(entry => entry.draft));
  ensure(workspace.dataset_sha256 === await datasetHash(sources), '검토 파일의 원본 평가셋 해시가 일치하지 않습니다.');
  if (casesInput !== undefined) {
    ensure(workspace.dataset_sha256 === await datasetHash(parseCases(casesInput)),
      '다른 평가셋의 검토 파일입니다. 검토를 시작했던 원본 사례 파일을 선택해 주세요.');
  }
  ensure(sources.some(item => item.id === workspace.selected_case_id), '검토 위치가 평가셋에 없는 문항을 가리킵니다.');
  await Promise.all(workspace.entries.map(async entry => {
    ensure(entry.source_sha256 === await hash(entry.source), `원본 문항 해시가 일치하지 않습니다: ${entry.source.id}`);
    validateDraft(entry);
    if (entry.status === 'approved') {
      ensure(entry.reviewer.trim(), `확인 완료에는 검토자 이름이 필요합니다: ${entry.source.id}`);
      ensure(entry.reviewed_at !== null && entry.approved_sha256 !== null,
        `확인 완료 기록이 빠져 있습니다: ${entry.source.id}`);
      ensure(entry.approved_sha256 === await hash(approvalContent(entry)),
        `확인 후 내용이 바뀐 문항입니다. 다시 검토해 주세요: ${entry.source.id}`);
    } else {
      ensure(entry.approved_sha256 === null, `미완료 문항에 승인 해시가 남아 있습니다: ${entry.source.id}`);
      ensure(entry.reviewed_at === null, `미완료 문항에 승인 시점이 남아 있습니다: ${entry.source.id}`);
    }
  }));
  return workspace;
}

/** Editing an approved answer or its reviewer/note requires a separate new confirmation. */
export async function updateOracleEntry(workspaceInput: OracleWorkspace, id: string, patchInput: OracleEntryPatch): Promise<OracleWorkspace> {
  const workspace = await validateOracleWorkspace(workspaceInput);
  const patch = oracleEntryPatchSchema.parse(patchInput);
  const entry = workspace.entries.find(item => item.source.id === id);
  ensure(entry, `검토할 문항을 찾을 수 없습니다: ${id}`);
  const previousApproval = await hash(approvalContent(entry));
  if (patch.draft !== undefined) entry.draft = patch.draft;
  if (patch.reviewer !== undefined) entry.reviewer = patch.reviewer;
  if (patch.note !== undefined) entry.note = patch.note;
  validateDraft(entry);
  const changed = previousApproval !== await hash(approvalContent(entry));
  const changedApproved = entry.status === 'approved' && changed;
  const requested = patch.status ?? entry.status;
  entry.status = changedApproved && requested === 'approved' ? 'pending' : requested;
  if (entry.status === 'approved') {
    ensure(entry.reviewer.trim(), `확인 완료에는 검토자 이름이 필요합니다: ${id}`);
    // Repeated confirmation with unchanged content does not invent a later review.
    if (entry.approved_sha256 === null || changed || workspaceInput.entries.find(item => item.source.id === id)?.status !== 'approved') {
      entry.reviewed_at = new Date().toISOString();
      entry.approved_sha256 = await hash(approvalContent(entry));
    }
  } else {
    entry.reviewed_at = null;
    entry.approved_sha256 = null;
  }
  workspace.selected_case_id = id;
  return validateOracleWorkspace(workspace);
}

/** Only confirmed drafts become verified cases; unfinished work never exports by accident. */
export async function exportOracleCases(workspaceInput: OracleWorkspace, options: { approvedOnly?: boolean } = {}): Promise<Case[]> {
  const workspace = await validateOracleWorkspace(workspaceInput);
  const approved = workspace.entries.filter(entry => entry.status === 'approved');
  ensure(approved.length > 0, '확인 완료한 문항이 없습니다.');
  ensure(options.approvedOnly || approved.length === workspace.entries.length,
    `아직 확인하지 않은 문항이 ${workspace.entries.length - approved.length}개 있습니다. 확인한 문항만 내보내려면 approvedOnly를 지정하세요.`);
  return parseCases(approved.map(entry => ({ ...entry.draft, review_status: 'verified', oracle_reviewer: entry.reviewer })));
}
