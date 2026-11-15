import { mkdir, readFile, realpath, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import { digest, parseJson, readRecords } from './json.js';
import { parseCases, runSchema } from './schema.js';
import { datasetHash, objectiveDetails } from './evaluate.js';
import { inspectSavedResponse } from './source-recheck.js';
import { automaticStatus, type AutomaticCheck } from './automatic-evaluation.js';

const sha = z.string().regex(/^sha256:[a-f0-9]{64}$/);
const manifestSchema = z.strictObject({
  schema: z.literal('graduation-wiki-eval/offline-report-input-v1'),
  source_contract: z.string().min(1), table_index: z.string().min(1).optional(),
  jobs: z.array(z.string().min(1)).min(1).max(10_000),
  analysis_notes: z.string().min(1).optional(),
});
const notesSchema = z.strictObject({
  schema: z.literal('graduation-wiki-eval/citation-analysis-notes-v1'),
  reviewer_kind: z.literal('assistant_analysis'), human_review: z.literal('pending'),
  source_pdf_sha256: sha,
  entries: z.array(z.strictObject({
    run_id: z.string().min(1), output_sha256: sha, citation_index: z.number().int().nonnegative(),
    citation_sha256: sha, category: z.string().min(1), reason: z.string().min(1),
  })),
});
const bytesHash = (bytes: Buffer) => 'sha256:' + createHash('sha256').update(bytes).digest('hex');
const label = { pass: '확인됨', fail: '실패 확인', inconclusive: '자동 검증 불가' };
const cell = (text: string) => text.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/\|/g,'&#124;').replace(/[\r\n]+/g,' ');

/** Reinspect captured responses; no adapter/authentication/provider imports.
 * Original execution statuses stay untouched. This is a selected-response audit,
 * not a replacement for the full plan's quality report or human review. */
export async function writeOfflineReport(casesFile: string, manifestFile: string, outputDirectory: string) {
  const manifestBytes = await readFile(manifestFile);
  const manifest = manifestSchema.parse(parseJson(manifestBytes.toString('utf8')));
  const base = path.dirname(path.resolve(manifestFile));
  const cases = parseCases(await readRecords(casesFile)), dataset = datasetHash(cases);
  const byCase = new Map(cases.map(item => [item.id,item]));
  const directories = await Promise.all(manifest.jobs.map(job => realpath(path.resolve(base,job))));
  if (new Set(directories).size !== directories.length) throw new Error('Duplicate saved job directories');
  const notesBytes = manifest.analysis_notes ? await readFile(path.resolve(base,manifest.analysis_notes)) : undefined;
  const notes = notesBytes ? notesSchema.parse(parseJson(notesBytes.toString('utf8'))) : undefined;
  const notesByKey = new Map<string, NonNullable<typeof notes>['entries'][number]>();
  for (const note of notes?.entries ?? []) {
    const key = `${note.run_id}:${note.citation_index}`;
    if (notesByKey.has(key)) throw new Error('Duplicate analysis note');
    notesByKey.set(key,note);
  }
  const seenRuns = new Set<string>(), seenSlots = new Set<string>(), usedNotes = new Set<string>();
  const inspectJob = async (directory: string) => {
    const recordBytes = await readFile(path.join(directory,'result.json'));
    const record = runSchema.parse(parseJson(recordBytes.toString('utf8')));
    const { request, trace, previous, result } = await inspectSavedResponse(directory,manifest.source_contract,
      manifest.table_index ? path.resolve(base,manifest.table_index) : undefined);
    const item = byCase.get(request.case_id), slot = `${record.case_id}:${record.condition}:${record.repeat}`;
    if (!item || digest(item) !== record.case_sha256 || record.versions.dataset !== dataset
      || record.case_id !== request.case_id || record.condition !== request.condition || record.run_id !== request.job_id
      || item.question !== request.question || digest(item.inputs ?? {}) !== digest(request.inputs)) throw new Error('Saved response does not match the frozen case');
    if (seenRuns.has(record.run_id) || seenSlots.has(slot)) throw new Error('Duplicate saved run or evaluation slot');
    seenRuns.add(record.run_id); seenSlots.add(slot);
    if (record.status === 'ok' && (record.output_sha256 !== previous.output_sha256 || digest(record.output) !== previous.output_sha256)) throw new Error('Saved run answer differs from source-check answer');
    const required = trace.required_skill_files ?? [];
    if (new Set(required).size !== required.length || required.some(file => !request.context.skills.includes(file))
      || (trace.required_skill_files === undefined && request.context.skills.length > 0)
      || (required.length > 0 && (required.length !== request.context.skills.length || !trace.fully_read_files))) throw new Error('Invalid saved required Skill read contract');
    const unread = required.filter(file => !trace.fully_read_files?.includes(file));
    const skillCheck: AutomaticCheck | null = required.length ? { id:'required_skill_reads', verdict:unread.length?'fail':'pass',
      reason:unread.length?`필수 문서 전체 읽기 누락: ${unread.join(', ')}`:'필수 문서 전체 읽기 확인', next_action:unread.length?'기존 읽기 누락을 그대로 유지하고 문서 전달 절차를 확인하세요.':'' } : null;
    const check = result.source_check;
    const issues = [...check.issues, ...(skillCheck && skillCheck.verdict !== 'pass' ? [skillCheck] : [])];
    const analysisNotes = [];
    for (const [index,citation] of previous.candidate_output.citations.entries()) {
      const key = `${record.run_id}:${index}`, note = notesByKey.get(key);
      if (!note) continue;
      if (note.output_sha256 !== previous.output_sha256 || note.citation_sha256 !== digest(citation)
        || notes?.source_pdf_sha256 !== check.pdf_sha256) throw new Error('Stale analysis note binding');
      usedNotes.add(key); analysisNotes.push(note);
    }
    const details = objectiveDetails(previous.candidate_output,item.expected);
    const row = { run_id:record.run_id, case_id:record.case_id, condition:record.condition, repeat:record.repeat,
      execution_status:'completed' as const, original_run_status:record.status,
      original_error:record.status==='error'?record.error:null,
      case_sha256:record.case_sha256, output_sha256:previous.output_sha256,
      source_pdf_sha256:check.pdf_sha256, source_contract_sha256:check.contract_sha256,
      input_files:{...result.input_files,'result.json':bytesHash(recordBytes)},
      objective_values:details.length?'fail' as const:'pass' as const, objective_details:details,
      source_status:check.status, source_citations:check.citations,
      skill_read_status:skillCheck?.verdict??'not_requested', unread_skill_files:unread,
      automatic_status:automaticStatus(issues), automatic_issues:issues,
      human_review:'pending' as const, answer_quality:'not_established' as const,
      assistant_analysis_notes:analysisNotes,
    };
    for (const [file,hash] of Object.entries(row.input_files)) {
      if (bytesHash(await readFile(path.join(directory,file))) !== hash) throw new Error('Original saved files changed during recheck');
    }
    return row;
  };
  const rows: Awaited<ReturnType<typeof inspectJob>>[] = [];
  for (const directory of directories) rows.push(await inspectJob(directory));
  if (usedNotes.size !== notesByKey.size) throw new Error('Analysis notes contain an unknown run or citation');
  const summarize = (selected: typeof rows) => ({
    responses:selected.length, completed:selected.length, original_run_errors:selected.filter(row=>row.original_run_status==='error').length,
    objective_values_pass:selected.filter(row=>row.objective_values==='pass').length,
    source_pass:selected.filter(row=>row.source_status==='pass').length, source_fail:selected.filter(row=>row.source_status==='fail').length,
    source_inconclusive:selected.filter(row=>row.source_status==='inconclusive').length,
    automatic_fail:selected.filter(row=>row.automatic_issues.some(issue=>issue.verdict==='fail')).length,
    automatic_inconclusive:selected.filter(row=>row.automatic_issues.some(issue=>issue.verdict==='inconclusive')).length,
    skill_read_fail:selected.filter(row=>row.skill_read_status==='fail').length,
    citations_pass:selected.reduce((n,row)=>n+row.source_citations.filter(c=>c.verdict==='pass').length,0),
    citations_fail:selected.reduce((n,row)=>n+row.source_citations.filter(c=>c.verdict==='fail').length,0),
    citations_inconclusive:selected.reduce((n,row)=>n+row.source_citations.filter(c=>c.verdict==='inconclusive').length,0),
    human_review_pending:selected.length,
  });
  const report = { schema:'graduation-wiki-eval/offline-report-v1', mode:'offline_recheck', model_calls:0,
    scope:'selected_saved_responses', checker_version:'citation-verdict-4',
    manifest_sha256:bytesHash(manifestBytes),dataset_sha256:dataset,analysis_notes_sha256:notesBytes?bytesHash(notesBytes):null,
    original_records_changed:false, human_review:'pending', quality_gate:'NOT_EVALUATED',
    summary:summarize(rows), conditions:Object.fromEntries(['A','B','C'].map(c=>[c,summarize(rows.filter(row=>row.condition===c))])), rows };
  const lines = ['# 저장된 응답 재검사','',
    '추가 모델 호출 0회. 선택한 저장 응답만 대조한 오프라인 보고서이며, 전체 계획의 실행률·품질 승인·새 모델 성능을 뜻하지 않습니다. 기존 run·report는 그대로 보존합니다.', '',
    '## 응답 생성과 평가 결과','',
    '| 조건 | 응답 생성 | 정답값 일치 | 인용 확인됨 | 인용 실패 확인 | 인용 자동 검증 불가 | Skill 읽기 실패 | 사람 검토 대기 |',
    '| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |'];
  for (const [c,s] of Object.entries(report.conditions)) lines.push(`| ${c} | ${s.completed} | ${s.objective_values_pass} | ${s.source_pass} | ${s.source_fail} | ${s.source_inconclusive} | ${s.skill_read_fail} | ${s.human_review_pending} |`);
  lines.push('', '위 표의 단위는 답변입니다. 인용 하나가 미검증이면 해당 답변의 인용 판정도 미검증입니다. 실패와 미검증이 함께 있으면 대표 상태는 실패이지만 상세에는 둘 다 남깁니다. 정답값 일치는 자연어 답변 전체의 정확성이나 근거 충분성을 보장하지 않습니다.', '',
    `개별 인용: 확인됨 ${report.summary.citations_pass}, 실패 확인 ${report.summary.citations_fail}, 자동 검증 불가 ${report.summary.citations_inconclusive}.`, '',
    '## 자동 검사와 별도 분석의 차이', '',
    '자동 검증 불가에는 미지원 표와 실제 단어 오류가 함께 있을 수 있습니다. 아래 AI 분석 메모는 원문 대조에서 발견한 내용을 보여주지만 자동 판정이나 사람 승인을 덮어쓰지 않습니다. 메모는 답변·인용·원문 해시와 묶었습니다.', '',
    '## 답변별 확인할 내용', '');
  for (const row of rows) {
    lines.push(`<details><summary>${cell(row.case_id)} / ${row.condition} — 응답 생성 완료 · 인용 ${label[row.source_status]}</summary>`, '',
      `기존 run 상태: ${row.original_run_status}. 정답값: ${row.objective_values}. Skill 읽기: ${row.skill_read_status}. 사람 검토: 대기.`, '');
    for (const issue of row.automatic_issues) lines.push(`- **${label[issue.verdict]}** ${cell(issue.id)}: ${cell(issue.reason)} 다음 확인: ${cell(issue.next_action)}`);
    for (const detail of row.objective_details) lines.push(`- 정답값 불일치: ${cell(detail.field)} / ${cell(detail.reason)} — 기대값 ${cell(JSON.stringify(detail.expected) ?? '없음')}, 응답값 ${cell(JSON.stringify(detail.actual) ?? '없음')}`);
    if (row.assistant_analysis_notes.length) lines.push('', 'AI 원문 대조 메모 — 사람 검토 전:', '', ...row.assistant_analysis_notes.map(note=>`- 인용 ${note.citation_index+1} / ${cell(note.category)}: ${cell(note.reason)}`));
    lines.push('', '</details>', '');
  }
  await mkdir(path.dirname(path.resolve(outputDirectory)),{recursive:true});
  await mkdir(outputDirectory); // Exclusive directory; never overwrite an earlier audit.
  await writeFile(path.join(outputDirectory,'report.json'),JSON.stringify(report,null,2)+'\n',{flag:'wx'});
  await writeFile(path.join(outputDirectory,'report.md'),lines.join('\n')+'\n',{flag:'wx'});
  return report;
}
