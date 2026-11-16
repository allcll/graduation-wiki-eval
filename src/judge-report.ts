import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import { digest, readJson } from './json.js';
import { loadJudgePlan, judgeResultSchema } from './judge.js';
import { validateJudgeReferences } from './judge-spec.js';

const escape=(value:string)=>value.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/\|/g,'&#124;').replace(/[\r\n]+/g,' ');
const label={pass:'충족',fail:'불충족',uncertain:'판단 보류'};

export async function writeJudgeReport(planFile:string,referencesFile:string,out:string) {
  const plan=await loadJudgePlan(planFile),root=path.dirname(path.resolve(planFile));
  const references=validateJudgeReferences(await readJson(referencesFile),plan);
  const expectedSlots=plan.entries.flatMap(e=>e.citation_indices.map(i=>e.id+':'+i));
  let execution: {plan_sha256:string;references_sha256:string}|null=null;
  try { execution=z.looseObject({plan_sha256:z.string(),references_sha256:z.string()}).parse(await readJson(path.join(root,'execution.json'))); }
  catch(error) { if(!(error instanceof Error && 'code' in error && error.code==='ENOENT')) throw error; }
  if(execution && (execution.plan_sha256!==plan.plan_sha256 || execution.references_sha256!==digest(references))) throw Error('References changed after judge execution started');
  const rows=[];
  for(const entry of plan.entries) {
    let result: z.infer<typeof judgeResultSchema>|null=null;
    try {result=judgeResultSchema.parse(await readJson(path.join(root,entry.id,'judge-result.json')));}
    catch(error) {if(!(error instanceof Error && 'code' in error && error.code==='ENOENT')) throw error;}
    if(result && !execution) throw Error('Judge result has no frozen execution record');
    if(result && (result.plan_sha256!==plan.plan_sha256 || result.input_sha256!==entry.input_sha256 || result.sample_id!==entry.id
      || result.answer_sha256!==entry.answer_sha256 || result.prompt_sha256!==plan.prompt_sha256
      || result.rubric_sha256!==plan.rubric_sha256 || result.source_pdf_sha256!==entry.source_pdf_sha256
      || result.output_sha256!==(result.output?digest(result.output):null))) throw Error('Stale judge result');
    if(result?.output && digest(result.output.citations.map(c=>c.citation_index).sort((a,b)=>a-b))!==digest([...entry.citation_indices].sort((a,b)=>a-b))) throw Error('Judge indices changed');
    const automatic=await readJson(path.join(root,entry.id,'automatic.json'));
    if(digest(automatic)!==entry.automatic_checks_sha256) throw Error('Original automatic checks changed');
    const comparisons=references.entries.filter(r=>r.sample_id===entry.id).map(reference=>{
      if(reference.answer_sha256!==entry.answer_sha256 || reference.source_pages.some(p=>!entry.evidence_pages.includes(p))) throw Error('Stale judge reference');
      const judgment=result?.output?.citations.find(c=>c.citation_index===reference.citation_index);
      const usable=result?.execution_status==='completed' && result.evidence_status==='verified' && result.unread_pages.length===0;
      const dimensions=(['quote_fidelity','source_relation'] as const).map(dimension=>({
        dimension,expected:reference.expected[dimension],actual:judgment?.[dimension].verdict??null,
        status:!usable||!judgment?'not_evaluated':reference.expected[dimension]===judgment[dimension].verdict?'agree':'disagree',
        false_accept:usable&&reference.expected[dimension]==='fail'&&judgment?.[dimension].verdict==='pass',
      }));
      return {citation_index:reference.citation_index,category:reference.category,reference_kind:'assistant_draft',
        reference_reason:reference.reason,source_pages:reference.source_pages,dimensions,judgment:judgment??null};
    });
    rows.push({sample_id:entry.id,case_id:entry.case_id,condition:entry.condition,run_id:entry.run_id,
      answer_sha256:entry.answer_sha256,source_pdf_sha256:entry.source_pdf_sha256,
      execution_status:result?.execution_status??'missing',evidence_status:result?.evidence_status??'not_evaluated',
      judge_model:result?.model??null,judge_output_sha256:result?.output_sha256??null,
      automatic_checks:automatic,comparisons,human_review:'pending'});
  }
  const dimensions=rows.flatMap(r=>r.comparisons.flatMap(c=>c.dimensions));
  const report={schema:'graduation-wiki-eval/judge-pilot-report-v1',plan_sha256:plan.plan_sha256,
    prompt_sha256:plan.prompt_sha256,rubric_sha256:plan.rubric_sha256,references_sha256:digest(references),
    reference_kind:'assistant_draft',human_review:'pending',automatic_promotion:false,quality_gate:'NOT_EVALUATED',
    summary:{planned_answers:rows.length,completed:rows.filter(r=>r.execution_status==='completed').length,
      evidence_verified:rows.filter(r=>r.evidence_status==='verified').length,
      selected_citations:expectedSlots.length,dimensions:dimensions.length,agree:dimensions.filter(d=>d.status==='agree').length,
      disagree:dimensions.filter(d=>d.status==='disagree').length,not_evaluated:dimensions.filter(d=>d.status==='not_evaluated').length,
      false_accepts_against_draft:dimensions.filter(d=>d.false_accept).length},rows};
  const md=['# 저장 답변의 LLM 인용 채점 표본','',
    '기존 답변을 재생성하지 않고 선택한 인용만 채점했습니다. 비교 기준은 AI가 원문을 대조해 작성한 초안이며 사람 검토는 대기입니다. 아래 일치 수는 사람이 확정한 정답에 대한 정확도가 아닙니다. 기존 코드 검사와 전체 품질 판정은 바꾸지 않습니다.','',
    '| 표본 | 사례 / 조건 | 실행 | 원문 페이지 확인 | 초안과 일치 | 불일치 | 미평가 |',
    '| --- | --- | --- | --- | ---: | ---: | ---: |'];
  for(const row of rows) {
    const ds=row.comparisons.flatMap(c=>c.dimensions);
    md.push('| '+[row.sample_id,row.case_id+' / '+row.condition,row.execution_status,row.evidence_status,
      ds.filter(d=>d.status==='agree').length,ds.filter(d=>d.status==='disagree').length,ds.filter(d=>d.status==='not_evaluated').length].join(' | ')+' |');
  }
  md.push('','각 인용의 원문 재현·표/의미 관계 두 항목을 초안과 비교합니다. 질문에 대한 적용 적합성은 모델 의견만 제시하며, 이번 초안 일치 수에는 넣지 않습니다.','');
  for(const row of rows) {
    md.push('<details><summary>'+escape(row.case_id+' / '+row.condition)+'</summary>','');
    for(const c of row.comparisons) {
      md.push('**인용 '+(c.citation_index+1)+' · '+c.category+'**','',
        '참조 초안: '+escape(c.reference_reason)+' (PDF '+c.source_pages.join(', ')+'쪽)','');
      for(const d of c.dimensions) md.push('- '+d.dimension+': 초안 '+label[d.expected]+' / 모델 '+(d.actual?label[d.actual]:'미평가')+' / '+d.status);
      if(c.judgment) for(const [name,value] of Object.entries(c.judgment)) {
        if(name==='citation_index'||typeof value==='number') continue;
        md.push('- '+name+' 근거: '+escape(value.reason),...value.evidence.map(e=>'  - PDF '+e.pdf_page+'쪽 '+escape(e.location)+': '+escape(e.excerpt)));
      }
      md.push('');
    }
    md.push('</details>','');
  }
  await mkdir(path.dirname(path.resolve(out)),{recursive:true});await mkdir(out);
  await writeFile(path.join(out,'report.json'),JSON.stringify(report,null,2)+'\n',{flag:'wx'});
  await writeFile(path.join(out,'report.md'),md.join('\n').trimEnd()+'\n',{flag:'wx'});
  return report;
}
