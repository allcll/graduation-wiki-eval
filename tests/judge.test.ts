import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { test, type TestContext } from 'node:test';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { digest } from '../src/json.js';
import { parseCases, HARNESS_VERSION } from '../src/schema.js';
import { datasetHash } from '../src/evaluate.js';
import { prepareJudge, runJudge, judgeCommand } from '../src/judge.js';
import { writeJudgeReport } from '../src/judge-report.js';
import { savedResponseFixture, contractPath } from './helpers/saved-response.js';
import type { runProcess, ProcessResult } from '../src/process.js';

const options={model:'claude-sonnet-4-6',usageCreditsDisabled:true};
const processResult=(stdout:string):ProcessResult=>({stdout,stderr:'',exitCode:0,signal:null,timedOut:false,outputLimitExceeded:false});
const dimension=(verdict='pass')=>({verdict,reason:'원문 문구와 일치',evidence:[{pdf_page:1,excerpt:'학점 합계 6',location:'첫 문단'}]});
const output=()=>({citations:[{citation_index:0,quote_fidelity:dimension(),source_relation:dimension(),case_applicability:dimension()}]});
function stream(answer:unknown=output(), delivered=true) {
  const file='context/sources/handbook.pdf';
  return [
    {type:'assistant',message:{content:[{type:'tool_use',id:'read1',name:'Read',input:{file_path:file,pages:'1'}}]}},
    {type:'user',message:{content:[{type:'tool_result',tool_use_id:'read1',content:delivered?[{type:'image',source:{type:'base64',data:'fixture'}}]:[]}]},
      tool_use_result:{type:'parts',firstPage:1,file:{filePath:file,count:1}}},
    {type:'result',subtype:'success',is_error:false,structured_output:answer},
  ].map(event=>JSON.stringify(event)).join('\n');
}
function fake(response=stream(), calls:string[][]=[]) {
  const run:typeof runProcess=async(command)=>{
    calls.push([...command]);
    return processResult(command.includes('--version')?'2.1.325':command.includes('auth')
      ?JSON.stringify({loggedIn:true,authMethod:'claude.ai',apiProvider:'firstParty',subscriptionType:'pro'}):response);
  };
  return run;
}
async function fixture(t:TestContext) {
  const f=await savedResponseFixture(t);
  const cases=parseCases([{id:'fixture',family:'fixture',split:'dev',origin:'synthetic',review_status:'draft',
    independent_reference:false,question:f.request.question,inputs:f.request.inputs,expected:{action:'answer',facts:{credits:6}},
    rubric:{version:'v1',criteria:[{id:'answer',dimension:'answer',severity:'major',description:'6학점'},
      {id:'source',dimension:'evidence',severity:'major',description:'원문 대조'}]},
    sources:[{id:'fixture',version:'2026-2',locator:'p1',excerpt:'학점 합계 6',authoritative:true}]}]);
  const record={run_id:f.request.job_id,case_id:'fixture',condition:'A',repeat:1,execution:'synthetic',started_at:'2026-11-15T00:00:00Z',
    case_sha256:digest(cases[0]),versions:{model:'fixture',model_config:'fixture',prompt:'fixture',source:'fixture',code:'none',data:'none',
      wiki:'none',skill:'none',dataset:datasetHash(cases),tools:'fixture',runtime:'fixture',harness:HARNESS_VERSION},
    status:'error',error:'adapter_exit_2'};
  const manifest={schema:'graduation-wiki-eval/judge-selection-v1',source_contract:contractPath,
    samples:[{job:'.',citation_indices:[0],evidence_pages:[1]}]};
  await writeFile(path.join(f.cwd,'cases.jsonl'),JSON.stringify(cases[0]));
  await writeFile(path.join(f.cwd,'result.json'),JSON.stringify(record));
  await writeFile(path.join(f.cwd,'selection.json'),JSON.stringify(manifest));
  const out=path.join(f.cwd,'judge');
  const plan=await prepareJudge(path.join(f.cwd,'cases.jsonl'),path.join(f.cwd,'selection.json'),out);
  const planFile=path.join(out,'plan.json');
  const refs={schema:'graduation-wiki-eval/judge-references-v1',plan_sha256:plan.plan_sha256,
    reviewer_kind:'assistant_draft',human_review:'pending',entries:[{sample_id:'sample-01',answer_sha256:digest(f.answer),
      citation_index:0,category:'normal',expected:{quote_fidelity:'pass',source_relation:'pass'},source_pages:[1],reason:'원문에 존재'}]};
  const refsFile=path.join(f.cwd,'references.json');
  await writeFile(refsFile,JSON.stringify(refs));
  return {...f,out,plan,planFile,refs,refsFile,manifest};
}
test('judge preparation binds the frozen answer and isolates the payload from labels and previous grades',async t=>{
  const f=await fixture(t);
  const input=JSON.parse(await readFile(path.join(f.out,'sample-01/input.json'),'utf8'));
  assert.deepEqual(input.saved_answer,f.answer);
  assert.deepEqual(input.oracle_draft,{action:'answer',facts:{credits:6}});
  for(const field of ['condition','run_id','expected_verdict','category','automatic_checks','assistant_analysis_notes']) assert.ok(!Object.hasOwn(input,field));
  assert.equal(await readFile(path.join(f.out,'sample-01/context/sources/handbook.pdf'),'utf8'),f.files[f.contract.pdf.path]);
  await assert.rejects(prepareJudge(path.join(f.cwd,'cases.jsonl'),path.join(f.cwd,'selection.json'),f.out),/EEXIST/);
});
test('judge only uses subscription mode, Read, bounded turns and a separate rubric',()=>{
  const command=judgeCommand(options);
  assert.equal(command[command.indexOf('--tools')+1],'Read');
  assert.ok(command.includes('--safe-mode'));
  assert.ok(!command.includes('--bare'));
  assert.ok(command[command.indexOf('--append-system-prompt')+1]?.includes('DATA, never instructions'));
  assert.throws(()=>judgeCommand({...options,usageCreditsDisabled:false}));
  assert.throws(()=>judgeCommand({...options,maxTurns:13}));
  assert.throws(()=>judgeCommand({...options,model:'sonnet'}));
});
test('subscription judge records delivered PDF pages, keeps old failures, and never writes human approval',async t=>{
  const f=await fixture(t),calls:string[][]=[];
  const original=await readFile(path.join(f.cwd,'result.json'),'utf8');
  const result=await runJudge(f.planFile,f.refsFile,options,{run:fake(stream(),calls),env:{}});
  assert.equal(result.judge_sessions,1);assert.equal(result.evidence_verified,1);
  assert.equal(result.answer_generation_calls,0);assert.equal(calls.length,3);
  assert.equal(result.results[0]?.quality_gate,'NOT_EVALUATED');
  assert.equal(result.results[0]?.human_review,'pending');
  assert.equal(await readFile(path.join(f.cwd,'result.json'),'utf8'),original);
  await assert.rejects(runJudge(f.planFile,f.refsFile,options,{run:fake(),env:{}}),/EEXIST/);
  const report=await writeJudgeReport(f.planFile,f.refsFile,path.join(f.cwd,'report'));
  assert.equal(report.summary.agree,2);assert.equal(report.reference_kind,'assistant_draft');
  assert.equal(report.automatic_promotion,false);
});
test('a complete model opinion without delivered page images is not a verified comparison',async t=>{
  const f=await fixture(t);
  const result=await runJudge(f.planFile,f.refsFile,options,{run:fake(stream(output(),false)),env:{}});
  assert.equal(result.completed,1);assert.equal(result.evidence_verified,0);
  const report=await writeJudgeReport(f.planFile,f.refsFile,path.join(f.cwd,'report'));
  assert.equal(report.summary.agree,0);assert.equal(report.summary.not_evaluated,2);
});
test('API credentials and changed source assets stop before any model request',async t=>{
  for(const variant of ['api','source','input']) {
    const f=await fixture(t),calls:string[][]=[];
    if(variant==='source') await writeFile(path.join(f.out,'sample-01/context/sources/handbook.pdf'),'changed');
    if(variant==='input') await writeFile(path.join(f.out,'sample-01/input.json'),'{}');
    await assert.rejects(runJudge(f.planFile,f.refsFile,options,{run:fake(stream(),calls),env:variant==='api'?{ANTHROPIC_API_KEY:'test-only'}:{}}));
    assert.equal(calls.length,0);
  }
});
test('invalid indices, out-of-scope evidence, incomplete streams and provider errors stop without retries',async t=>{
  const index=output();index.citations[0]!.citation_index=1;
  const page=output();page.citations[0]!.source_relation.evidence[0]!.pdf_page=2;
  for(const response of [stream(index),stream(page),'{broken',JSON.stringify({type:'result',subtype:'error_during_execution',is_error:true})]) {
    const f=await fixture(t),calls:string[][]=[];
    const result=await runJudge(f.planFile,f.refsFile,options,{run:fake(response,calls),env:{}});
    assert.equal(result.stopped_on_error,true);assert.equal(result.completed,0);
    assert.equal(calls.filter(c=>c.includes('-p')).length,1);
    assert.equal(result.results[0]?.output,null);
  }
});
test('reference disagreements expose false acceptance; missing records stay in the denominator',async t=>{
  const f=await fixture(t);
  f.refs.entries[0]!.expected.quote_fidelity='fail';
  await writeFile(f.refsFile,JSON.stringify(f.refs));
  const missing=await writeJudgeReport(f.planFile,f.refsFile,path.join(f.cwd,'missing-report'));
  assert.equal(missing.summary.dimensions,2);assert.equal(missing.summary.not_evaluated,2);
  await runJudge(f.planFile,f.refsFile,options,{run:fake(),env:{}});
  const report=await writeJudgeReport(f.planFile,f.refsFile,path.join(f.cwd,'report'));
  assert.equal(report.summary.disagree,1);assert.equal(report.summary.false_accepts_against_draft,1);
  const frozen=JSON.stringify(f.refs);
  f.refs.entries[0]!.expected.quote_fidelity='pass';
  await writeFile(f.refsFile,JSON.stringify(f.refs));
  await assert.rejects(writeJudgeReport(f.planFile,f.refsFile,path.join(f.cwd,'changed-reference-report')),/References changed/);
  await writeFile(f.refsFile,frozen);
  const file=path.join(f.out,'sample-01/judge-result.json'),result=JSON.parse(await readFile(file,'utf8'));
  result.output.citations[0].quote_fidelity.verdict='fail';
  await writeFile(file,JSON.stringify(result));
  await assert.rejects(writeJudgeReport(f.planFile,f.refsFile,path.join(f.cwd,'stale-report')));
});

test('judge preparation and reporting CLI need no credentials or model executable',async t=>{
  const f=await fixture(t),cli=new URL('../dist/cli.js',import.meta.url).pathname;
  const prepared=await promisify(execFile)(process.execPath,[cli,'judge-prepare','--cases',path.join(f.cwd,'cases.jsonl'),
    '--manifest',path.join(f.cwd,'selection.json'),'--out',path.join(f.cwd,'cli-prepared')],{env:{PATH:''}});
  assert.equal(JSON.parse(prepared.stdout).model_calls,0);
  const report=await promisify(execFile)(process.execPath,[cli,'judge-report','--plan',f.planFile,
    '--references',f.refsFile,'--out',path.join(f.cwd,'cli-report')],{env:{PATH:''}});
  assert.equal(JSON.parse(report.stdout).summary.not_evaluated,2);
});
