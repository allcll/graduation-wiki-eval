import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { test, type TestContext } from 'node:test';
import { digest } from '../src/json.js';
import { datasetHash } from '../src/evaluate.js';
import { parseCases, HARNESS_VERSION } from '../src/schema.js';
import { writeOfflineReport } from '../src/offline-report.js';
import { savedResponseFixture, hash, contractPath } from './helpers/saved-response.js';

async function fixture(t: TestContext, citations?: string[], skill = false) {
  const saved = await savedResponseFixture(t), { cwd, request, trace, previous, answer } = saved;
  if (citations) answer.citations = citations;
  if (skill) {
    request.condition = 'C';
    request.context.wiki.push('context/wiki/index.md');
    request.context.skills.push('context/skills/SKILL.md');
    for (const file of [...request.context.wiki, ...request.context.skills]) {
      await mkdir(path.dirname(path.join(cwd,file)),{recursive:true});
      await writeFile(path.join(cwd,file),'fixture');
    }
  }
  const cases = parseCases([{ id:'fixture',family:'fixture',split:'dev',origin:'synthetic',review_status:'draft',
    independent_reference:false,question:request.question,inputs:request.inputs,expected:{action:'answer',facts:{credits:6}},
    rubric:{version:'v1',criteria:[
      {id:'answer',dimension:'answer',severity:'major',description:'Explain credits'},
      {id:'source',dimension:'evidence',severity:'major',description:'Use the applicable source'},
    ]},sources:[{id:'fixture',version:'2026-2',locator:'p1',excerpt:'6',authoritative:true}] }]);
  const record = { run_id:request.job_id,case_id:request.case_id,condition:request.condition,repeat:1,
    execution:'synthetic',started_at:'2026-11-15T00:00:00Z',case_sha256:digest(cases[0]),
    versions:{model:'fixture',model_config:'fixture',prompt:'fixture',source:'fixture',code:'none',data:'none',
      wiki:'none',skill:'none',dataset:datasetHash(cases),tools:'fixture',runtime:'fixture',harness:HARNESS_VERSION},
    status:'error',error:'adapter_exit_2' };
  const manifest = {schema:'graduation-wiki-eval/offline-report-input-v1',source_contract:contractPath,jobs:['.']};
  const files = {'cases.jsonl':JSON.stringify(cases[0])+'\n','result.json':JSON.stringify(record),'manifest.json':JSON.stringify(manifest),
    'request.json':JSON.stringify(request),'claude-tools.json':JSON.stringify({...trace,request_sha256:digest(request),
      required_skill_files:request.context.skills,fully_read_files:[]}),
    'source-check.json':JSON.stringify({...previous,request_sha256:digest(request),output_sha256:digest(answer),candidate_output:answer})};
  for (const [file,value] of Object.entries(files)) await writeFile(path.join(cwd,file),value);
  const run = (out='new-report')=>writeOfflineReport(path.join(cwd,'cases.jsonl'),path.join(cwd,'manifest.json'),path.join(cwd,out));
  return {...saved,files,manifest,cases,record,run};
}

test('completed saved answers keep definite failures and unknown quotes separate, without altering records', async t=>{
  const f=await fixture(t,[
    '[source=fixture;edition=2025-2;pdf_page=1] 학점 합계 6',
    '[source=fixture;edition=2026-2;pdf_page=1] 코드가 판별할 수 없는 표 관계',
  ],true);
  const result=await f.run();
  assert.equal(result.rows[0]?.execution_status,'completed');
  assert.equal(result.rows[0]?.original_run_status,'error');
  assert.equal(result.summary.source_fail,1);
  assert.equal(result.summary.citations_fail,1);
  assert.equal(result.summary.citations_inconclusive,1);
  assert.equal(result.summary.automatic_fail,1);
  assert.equal(result.summary.automatic_inconclusive,1);
  assert.equal(result.summary.skill_read_fail,1);
  assert.equal(result.summary.objective_values_pass,1);
  assert.equal(result.human_review,'pending');
  assert.equal(result.quality_gate,'NOT_EVALUATED');
  assert.equal(result.model_calls,0);
  for (const [name,bytes] of Object.entries(f.files)) assert.equal(await readFile(path.join(f.cwd,name),'utf8'),bytes);
  await assert.rejects(f.run(),/EEXIST/);
});

test('unmatched quotes stay inconclusive; source matches still require semantic review',async t=>{
  for(const citations of [undefined,['[source=fixture;edition=2026-2;pdf_page=1] 알 수 없는 표현']]) {
    const f=await fixture(t,citations), result=await f.run();
    assert.equal(result.summary.source_fail,0);
    assert.equal(result.rows[0]?.source_status,citations?'inconclusive':'pass');
    assert.equal(result.rows[0]?.answer_quality,'not_established');
    assert.equal(result.rows[0]?.human_review,'pending');
  }
});

test('offline reports reject stale cases, duplicate jobs, incomplete executions and missing Skill contracts', async t=>{
  for(const variant of ['case','duplicate','incomplete','process_error','skill_contract']) {
    const f=await fixture(t,undefined,variant==='skill_contract');
    if(variant==='case') await writeFile(path.join(f.cwd,'cases.jsonl'),JSON.stringify({...f.cases[0],question:'changed'}));
    if(variant==='duplicate') await writeFile(path.join(f.cwd,'manifest.json'),JSON.stringify({...f.manifest,jobs:['.','./']}));
    if(variant==='incomplete'||variant==='process_error') await writeFile(path.join(f.cwd,'claude-tools.json'),JSON.stringify({
      ...f.trace,complete:variant!=='incomplete',process:{...f.trace.process,exit_code:variant==='process_error'?1:0}}));
    if(variant==='skill_contract') {
      const trace=JSON.parse(f.files['claude-tools.json']);delete trace.required_skill_files;
      await writeFile(path.join(f.cwd,'claude-tools.json'),JSON.stringify(trace));
    }
    await assert.rejects(f.run());
  }
});

test('AI notes are bound to the answer, exact citation and original PDF, and never become a human verdict',async t=>{
  const f=await fixture(t,['[source=fixture;edition=2026-2;pdf_page=1] 알 수 없는 표현']);
  const note={run_id:f.request.job_id,output_sha256:digest(f.answer),citation_index:0,
    citation_sha256:digest(f.answer.citations[0]),category:'table_unhandled',reason:'표 관계를 사람이 확인해야 함'};
  const notes={schema:'graduation-wiki-eval/citation-analysis-notes-v1',reviewer_kind:'assistant_analysis',
    human_review:'pending',source_pdf_sha256:f.contract.pdf.sha256,entries:[note]};
  await writeFile(path.join(f.cwd,'manifest.json'),JSON.stringify({...f.manifest,analysis_notes:'notes.json'}));
  await writeFile(path.join(f.cwd,'notes.json'),JSON.stringify(notes));
  const result=await f.run();
  assert.equal(result.rows[0]?.source_status,'inconclusive');
  assert.equal(result.rows[0]?.assistant_analysis_notes.length,1);
  assert.equal(result.rows[0]?.human_review,'pending');
  for(const variant of ['answer','citation','pdf','unknown']) {
    const entry={...note, ...(variant==='answer'?{output_sha256:hash('changed')}:{ }),
      ...(variant==='citation'?{citation_sha256:hash('changed')}:{ }),
      ...(variant==='unknown'?{run_id:'other'}:{ })};
    await writeFile(path.join(f.cwd,'notes.json'),JSON.stringify({...notes,entries:[entry],
      ...(variant==='pdf'?{source_pdf_sha256:hash('changed')}:{ })}));
    await assert.rejects(f.run(variant),/Stale analysis note|unknown run/);
  }
});

test('recheck-report CLI needs no model executable or credentials',async t=>{
  const f=await fixture(t);
  const {stdout}=await promisify(execFile)(process.execPath,[new URL('../dist/cli.js',import.meta.url).pathname,
    'recheck-report','--cases',path.join(f.cwd,'cases.jsonl'),'--manifest',path.join(f.cwd,'manifest.json'),
    '--out',path.join(f.cwd,'cli-report')],{env:{PATH:''}});
  const report=JSON.parse(stdout);
  assert.equal(report.model_calls,0);
  assert.equal(report.summary.completed,1);
  assert.equal(report.quality_gate,'NOT_EVALUATED');
});
