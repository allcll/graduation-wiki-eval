import { copyFile, mkdir, open, readFile, realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import { digest, readJson, readRecords, parseJson } from './json.js';
import { writeJson } from './io.js';
import { parseCases, runSchema } from './schema.js';
import { datasetHash } from './evaluate.js';
import { inspectSavedResponse } from './source-recheck.js';
import { loadSourceContract } from './adapters/source-citations.js';
import { buildCommand, verifyClaudeAccess } from './adapters/claude.js';
import { summarizeClaudeStream } from './adapters/claude-trace.js';
import { runProcess } from './process.js';
import { judgeAnswerSchema, judgeJsonSchema, judgeInstructions, judgePromptHash, judgeRubric, validateJudgeReferences } from './judge-spec.js';
import type { AdapterRequest } from './adapters/request.js';

const sha = z.string().regex(/^sha256:[a-f0-9]{64}$/);
const indexes = z.array(z.number().int().nonnegative()).min(1).max(8).refine(v=>new Set(v).size===v.length);
const pages = z.array(z.number().int().positive()).min(1).max(8).refine(v=>new Set(v).size===v.length);
const selectionSchema = z.strictObject({
  schema:z.literal('graduation-wiki-eval/judge-selection-v1'),
  source_contract:z.string().min(1), table_index:z.string().min(1).optional(),
  samples:z.array(z.strictObject({job:z.string().min(1),citation_indices:indexes,evidence_pages:pages})).min(1).max(10),
});
const planSchema = z.strictObject({
  schema:z.literal('graduation-wiki-eval/judge-plan-v1'),
  prompt_sha256:sha, rubric_sha256:sha, dataset_sha256:sha,
  selection_sha256:sha, plan_sha256:sha,
  entries:z.array(z.strictObject({
    id:z.string().regex(/^sample-\d{2}$/), run_id:z.string().min(1), case_id:z.string().min(1),
    condition:z.enum(['A','B','C']), case_sha256:sha, answer_sha256:sha, input_sha256:sha,
    source_pdf_sha256:sha, source_text_sha256:sha, source_contract_sha256:sha,
    pdf_file:z.literal('context/sources/handbook.pdf'), citation_indices:indexes, evidence_pages:pages,
    original_files:z.record(z.string(),sha), automatic_checks_sha256:sha,
  })).min(1).max(10),
}).refine(p=>new Set(p.entries.map(e=>e.id)).size===p.entries.length, 'Duplicate sample IDs');
export type JudgePlan = z.infer<typeof planSchema>;
const byteHash = (bytes:Buffer)=>'sha256:'+createHash('sha256').update(bytes).digest('hex');

export async function prepareJudge(casesFile:string, manifestFile:string, out:string):Promise<JudgePlan> {
  const manifest=selectionSchema.parse(await readJson(manifestFile));
  const base=path.dirname(path.resolve(manifestFile));
  const cases=parseCases(await readRecords(casesFile));
  const dataset=datasetHash(cases), prepared=[], seen=new Set<string>();
  // Validate all inputs before creating the isolated judge workspace.
  for(const selected of manifest.samples) {
    const job=await realpath(path.resolve(base,selected.job));
    const recordBytes=await readFile(path.join(job,'result.json'));
    const record=runSchema.parse(parseJson(recordBytes.toString('utf8')));
    const saved=await inspectSavedResponse(job,manifest.source_contract,manifest.table_index?path.resolve(base,manifest.table_index):undefined);
    const item=cases.find(c=>c.id===record.case_id);
    if(!item || record.case_sha256!==digest(item) || record.versions.dataset!==dataset
      || record.run_id!==saved.request.job_id || record.case_id!==saved.request.case_id || record.condition!==saved.request.condition
      || item.question!==saved.request.question || digest(item.inputs??{})!==digest(saved.request.inputs)) throw Error('Judge input differs from frozen case');
    if(record.status==='ok' && (record.output_sha256!==saved.previous.output_sha256 || digest(record.output)!==saved.previous.output_sha256)) throw Error('Saved answer mismatch');
    if(seen.has(record.run_id)) throw Error('Duplicate saved answer in judge selection');
    seen.add(record.run_id);
    const source=await loadSourceContract(manifest.source_contract,saved.request,job);
    for(const index of selected.citation_indices) {
      const citation=saved.previous.candidate_output.citations[index];
      const check=saved.result.source_check.citations[index];
      if(!citation || !check?.pdf_page || !selected.evidence_pages.includes(check.pdf_page)) throw Error('Selected citation needs its original page');
    }
    if(selected.evidence_pages.some(page=>page>source.contract.pdf.pages)) throw Error('Evidence page outside source PDF');
    const input={
      task:'Evaluate only selected citations in the saved answer.',
      question:item.question,inputs:item.inputs??{},saved_answer:saved.previous.candidate_output,
      oracle_draft:item.expected,case_rubric:item.rubric,
      selected_citation_indices:selected.citation_indices,
      source:{source_id:source.contract.source_id,edition:source.contract.edition,
        pdf_file:'context/sources/handbook.pdf',required_pdf_pages:selected.evidence_pages,
        extracted_pages:selected.evidence_pages.map(page=>({pdf_page:page,text:source.pages[page-1]}))},
    };
    if(Buffer.byteLength(JSON.stringify(input))>160_000) throw Error('Judge input exceeds 160 KB');
    const automatic={source_check:saved.result.source_check,
      required_skill_files:saved.trace.required_skill_files??[],
      unread_skill_files:(saved.trace.required_skill_files??[]).filter(file=>!saved.trace.fully_read_files?.includes(file))};
    prepared.push({job,record,item,saved,source,input,automatic,recordBytes,selected});
  }
  await mkdir(path.dirname(path.resolve(out)),{recursive:true});
  await mkdir(out);
  const entries:JudgePlan['entries']=[];
  for(const [index,p] of prepared.entries()) {
    const id='sample-'+String(index+1).padStart(2,'0'), folder=path.join(out,id);
    await mkdir(path.join(folder,'context/sources'),{recursive:true});
    await copyFile(path.join(p.job,p.source.contract.pdf.path),path.join(folder,'context/sources/handbook.pdf'));
    await writeJson(path.join(folder,'input.json'),p.input,true);
    await writeJson(path.join(folder,'automatic.json'),p.automatic,true);
    const originalFiles={...p.saved.result.input_files,'result.json':byteHash(p.recordBytes)};
    for(const [file,hash] of Object.entries(originalFiles)) if(byteHash(await readFile(path.join(p.job,file)))!==hash) throw Error('Original changed during judge preparation');
    entries.push({id,run_id:p.record.run_id,case_id:p.item.id,condition:p.record.condition,case_sha256:digest(p.item),
      answer_sha256:p.saved.previous.output_sha256,input_sha256:digest(p.input),source_pdf_sha256:p.source.contract.pdf.sha256,
      source_text_sha256:p.source.contract.text.sha256,source_contract_sha256:p.source.contract_sha256,
      pdf_file:'context/sources/handbook.pdf',citation_indices:p.selected.citation_indices,evidence_pages:p.selected.evidence_pages,
      original_files:originalFiles,automatic_checks_sha256:digest(p.automatic)});
  }
  const unsigned={schema:'graduation-wiki-eval/judge-plan-v1' as const,prompt_sha256:judgePromptHash,
    rubric_sha256:digest(judgeRubric),dataset_sha256:dataset,selection_sha256:digest(manifest),entries};
  const plan=planSchema.parse({...unsigned,plan_sha256:digest(unsigned)});
  await writeJson(path.join(out,'plan.json'),plan,true);
  return plan;
}

export async function loadJudgePlan(file:string) {
  const plan=planSchema.parse(await readJson(file));
  const {plan_sha256,...unsigned}=plan;
  if(plan_sha256!==digest(unsigned) || plan.prompt_sha256!==judgePromptHash || plan.rubric_sha256!==digest(judgeRubric)) throw Error('Judge plan or prompt changed; prepare a new plan');
  return plan;
}
async function verifyWorkspace(root:string,entry:JudgePlan['entries'][number]) {
  const cwd=path.join(root,entry.id);
  const names=['input.json','automatic.json',entry.pdf_file];
  for(const file of names) {
    const resolved=await realpath(path.join(cwd,file)), relative=path.relative(await realpath(cwd),resolved);
    if(relative.startsWith('..') || path.isAbsolute(relative) || !(await stat(resolved)).isFile()) throw Error('Judge asset escapes workspace');
  }
  const input=await readJson(path.join(cwd,'input.json')), automatic=await readJson(path.join(cwd,'automatic.json'));
  if(digest(input)!==entry.input_sha256 || digest(automatic)!==entry.automatic_checks_sha256
    || byteHash(await readFile(path.join(cwd,entry.pdf_file)))!==entry.source_pdf_sha256) throw Error('Judge workspace changed');
  return {cwd,input};
}
export const judgeResultSchema = z.strictObject({
  schema:z.literal('graduation-wiki-eval/judge-result-v1'),sample_id:z.string(),plan_sha256:sha,
  input_sha256:sha,answer_sha256:sha,prompt_sha256:sha,rubric_sha256:sha,source_pdf_sha256:sha,
  model:z.string().min(1),cli_version:z.string(),auth:z.literal('subscription'),api_fallback:z.literal(false),
  execution_status:z.enum(['completed','error']),error:z.string().nullable(),elapsed_ms:z.number().nonnegative(),
  output:judgeAnswerSchema.nullable(),output_sha256:sha.nullable(),
  evidence_status:z.enum(['verified','unverified','not_evaluated']),unread_pages:z.array(z.number().int().positive()),
  human_review:z.literal('pending'),quality_gate:z.literal('NOT_EVALUATED'),
}).superRefine((r,ctx)=>{
  if(r.output_sha256!==(r.output?digest(r.output):null)
    || (r.execution_status==='completed' && (!r.output || r.error!==null || r.evidence_status==='not_evaluated'))
    || (r.execution_status==='error' && (r.output!==null || !r.error || r.evidence_status!=='not_evaluated'))
    || (r.evidence_status==='verified' && r.unread_pages.length!==0)
    || (r.evidence_status==='unverified' && r.unread_pages.length===0))
    ctx.addIssue({code:'custom',message:'Inconsistent judge execution or evidence result'});
});
export type JudgeResult=z.infer<typeof judgeResultSchema>;
export interface JudgeOptions {model:string;usageCreditsDisabled:boolean;maxTurns?:number;timeoutSeconds?:number}
export interface JudgeDependencies {run?:typeof runProcess;env?:NodeJS.ProcessEnv;executable?:string}

export function judgeCommand(options:JudgeOptions,executable='claude') {
  if(!options.usageCreditsDisabled) throw Error('Confirm extra usage is disabled; no API fallback exists');
  if((options.maxTurns??6)>12 || (options.timeoutSeconds??180)>300) throw Error('Judge pilot limits are 12 turns and 300 seconds');
  const command=buildCommand({auth:'subscription',usageCreditsDisabled:true,model:options.model,
    traceTools:true,executable,maxTurns:options.maxTurns??6,timeoutSeconds:options.timeoutSeconds??180});
  command[command.indexOf('--tools')+1]='Read';
  command[command.indexOf('--allowedTools')+1]='Read';
  command[command.indexOf('--json-schema')+1]=JSON.stringify(judgeJsonSchema);
  command[command.indexOf('--append-system-prompt')+1]=judgeInstructions;
  return command;
}

export async function runJudge(planFile:string,referencesFile:string,options:JudgeOptions,dependencies:JudgeDependencies={}) {
  const plan=await loadJudgePlan(planFile),root=path.dirname(path.resolve(planFile));
  const run=dependencies.run??runProcess,env=dependencies.env??process.env,executable=dependencies.executable??'claude';
  const command=judgeCommand(options,executable);
  const references=validateJudgeReferences(await readJson(referencesFile),plan);
  for(const entry of plan.entries) await verifyWorkspace(root,entry);
  // Reserve a run before authentication. No resume/retry can silently spend more quota.
  const lock=await open(path.join(root,'execution.json'),'wx',0o600);
  await lock.writeFile(JSON.stringify({plan_sha256:plan.plan_sha256,references_sha256:digest(references),model:options.model,auth:'subscription',
    usage_credits_disabled_confirmation:true,max_turns:options.maxTurns??6,timeout_seconds:options.timeoutSeconds??180,
    started_at:new Date().toISOString(),automatic_retry:false,api_fallback:false})+'\n');
  await lock.close();
  const version=await verifyClaudeAccess({auth:'subscription',executable},root,env,run);
  const results:JudgeResult[]=[];
  for(const entry of plan.entries) {
    const {cwd,input}=await verifyWorkspace(root,entry);
    const request:AdapterRequest={job_id:entry.id,case_id:entry.case_id,condition:'A',question:'Citation evaluation',
      inputs:{},context:{sources:[entry.pdf_file],wiki:[],skills:[]},instructions:judgeInstructions,output_contract:{}};
    let output:JudgeResult['output']=null,error:string|null=null,trace:ReturnType<typeof summarizeClaudeStream>['trace']|null=null;
    let execution:JudgeResult['execution_status']='error',unread=[...entry.evidence_pages];
    const started=performance.now();
    try {
      const captured=await run(command,{cwd,input:JSON.stringify(input),timeoutMs:(options.timeoutSeconds??180)*1000,
        forwardSignals:true,env:{...env,CLAUDE_CODE_DISABLE_FAST_MODE:'1',CLAUDE_CODE_DISABLE_AUTO_MEMORY:'1',
          CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC:'1',CLAUDE_CODE_DISABLE_BACKGROUND_TASKS:'1',
          CLAUDE_CODE_DISABLE_TERMINAL_TITLE:'1',CLAUDE_CODE_EFFORT_LEVEL:'medium',MAX_STRUCTURED_OUTPUT_RETRIES:'1'}});
      const parsed=summarizeClaudeStream(captured.stdout,request,cwd);trace=parsed.trace;
      if(captured.timedOut || captured.outputLimitExceeded || captured.exitCode!==0) throw Error('judge_process_failed');
      if(!trace.complete) throw Error('judge_stream_incomplete');
      if(trace.calls.some(call=>call.tool==='Read'&&call.path!==entry.pdf_file)) throw Error('judge_unlisted_read');
      const final=z.looseObject({type:z.literal('result'),subtype:z.literal('success'),is_error:z.literal(false),structured_output:judgeAnswerSchema}).safeParse(parsed.result);
      if(!final.success) throw Error('judge_output_invalid');
      const answer=final.data.structured_output;
      if(digest(answer.citations.map(c=>c.citation_index).sort((a,b)=>a-b))!==digest([...entry.citation_indices].sort((a,b)=>a-b))) throw Error('judge_citation_indices_mismatch');
      for(const citation of answer.citations) for(const dimension of [citation.quote_fidelity,citation.source_relation,citation.case_applicability])
        if(dimension.evidence.some(e=>!entry.evidence_pages.includes(e.pdf_page))) throw Error('judge_evidence_page_outside_selection');
      unread=entry.evidence_pages.filter(page=>!trace!.calls.some(call=>call.tool==='Read'&&call.status==='success'
        &&call.path===entry.pdf_file&&call.delivered_pages&&page>=call.delivered_pages.start&&page<call.delivered_pages.start+call.delivered_pages.count));
      await verifyWorkspace(root,entry);
      output=answer;execution='completed';
    } catch(caught) {
      // Neither raw stderr nor arbitrary upstream exception text is persisted.
      const message=caught instanceof Error?caught.message:'';
      error=/^judge_[a-z_]+$/.test(message)?message:'judge_execution_failed';
    }
    const result=judgeResultSchema.parse({schema:'graduation-wiki-eval/judge-result-v1',sample_id:entry.id,
      plan_sha256:plan.plan_sha256,input_sha256:entry.input_sha256,answer_sha256:entry.answer_sha256,
      prompt_sha256:plan.prompt_sha256,rubric_sha256:plan.rubric_sha256,source_pdf_sha256:entry.source_pdf_sha256,
      model:options.model,cli_version:version,auth:'subscription',api_fallback:false,
      execution_status:execution,error,elapsed_ms:performance.now()-started,output,output_sha256:output?digest(output):null,
      evidence_status:output?(unread.length?'unverified':'verified'):'not_evaluated',unread_pages:unread,
      human_review:'pending',quality_gate:'NOT_EVALUATED'});
    await writeJson(path.join(cwd,'judge-tools.json'),trace,true);
    await writeJson(path.join(cwd,'judge-result.json'),result,true);
    results.push(result);
    if(execution==='error') break; // Includes limit errors; no retry, API key, or model fallback.
  }
  return {planned:plan.entries.length,judge_sessions:results.length,answer_generation_calls:0,
    completed:results.filter(r=>r.execution_status==='completed').length,
    evidence_verified:results.filter(r=>r.evidence_status==='verified').length,
    stopped_on_error:results.some(r=>r.execution_status==='error'),results};
}
