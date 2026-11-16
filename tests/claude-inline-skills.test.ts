import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test, type TestContext } from 'node:test';
import { buildCommand, invokeClaude } from '../src/adapters/claude.js';
import type { AdapterRequest } from '../src/adapters/request.js';
import type { ProcessResult, runProcess } from '../src/process.js';

const options = { model: 'fixture-model', budgetUsd: 0.1, traceTools: true, skillDelivery: 'inline' as const };
const answer = { action: 'answer', facts: {}, answer_text: 'fixture response', citations: [] };
const response = JSON.stringify({ type: 'result', subtype: 'success', is_error: false, structured_output: answer });
const result = (stdout: string): ProcessResult => ({ stdout, stderr: '', exitCode: 0, signal: null, timedOut: false, outputLimitExceeded: false });
const bodies = {
  'context/skills/.claude/SKILL.md': '# Wrapper\n@../body.md',
  'context/skills/CLAUDE.md': '# Entry\n@PROJECT.md',
  'context/skills/body.md': '# Query\nCompare the original source.',
  'context/skills/PROJECT.md': '# Shared rules\nCheck the target cohort and exceptions.',
};
async function fixture(t: TestContext) {
  const cwd = await mkdtemp(path.join(tmpdir(), 'inline-skills-'));
  t.after(() => rm(cwd, { recursive: true, force: true }));
  for (const [file, text] of Object.entries({ ...bodies, 'context/sources/source.md': 'Source', 'context/wiki/rule.md': 'Wiki' })) {
    await mkdir(path.dirname(path.join(cwd, file)), { recursive: true });
    await writeFile(path.join(cwd, file), text);
  }
  const request: AdapterRequest = { job_id: 'C-1', case_id: 'fixture', condition: 'C', question: 'Same question', inputs: { cohort: 2022 },
    instructions: 'Same request instructions', output_contract: {}, context: {
      sources: ['context/sources/source.md'], wiki: ['context/wiki/rule.md'], skills: Object.keys(bodies) } };
  return { cwd, request };
}

test('inline C puts every required body in the actual stdin payload and records hashes before invocation', async t => {
  const f = await fixture(t);
  let calls = 0;
  const run: typeof runProcess = async (command, process) => {
    if (command.includes('--version')) return result('2.1.325');
    calls++;
    const payload = JSON.parse(process.input);
    assert.deepEqual(payload.skill_documents, Object.entries(bodies).map(([file, content]) => ({ path: file, content })));
    assert.equal(payload.question, f.request.question);
    assert.deepEqual(payload.inputs, f.request.inputs);
    const record = JSON.parse(await readFile(path.join(f.cwd, 'skill-delivery.json'), 'utf8'));
    assert.equal(record.mode, 'inline');
    assert.equal(record.stage, 'prepared_for_stdin');
    assert.equal(record.model_input_sha256, 'sha256:' + createHash('sha256').update(process.input).digest('hex'));
    assert.equal(record.files.length, 4);
    for (const file of record.files) {
      const bytes = Buffer.from(bodies[file.path as keyof typeof bodies]);
      assert.equal(file.bytes, bytes.length);
      assert.equal(file.sha256, 'sha256:' + createHash('sha256').update(bytes).digest('hex'));
    }
    const prompt = command.at(-1)!;
    assert.match(prompt, /Apply every supplied document/);
    assert.doesNotMatch(prompt, /choose which are relevant/);
    return result(response); // No Read events: payload delivery must not masquerade as tool reads.
  };
  assert.deepEqual(await invokeClaude(f.request, options, { cwd: f.cwd, env: { ANTHROPIC_API_KEY: 'fixture' }, run }), answer);
  assert.equal(calls, 1);
  const trace = JSON.parse(await readFile(path.join(f.cwd, 'claude-tools.json'), 'utf8'));
  assert.deepEqual(trace.fully_read_files, []);
  assert.deepEqual(trace.required_skill_files, []);
  assert(!await readFile(path.join(f.cwd, 'skill-delivery.json'), 'utf8').then(x => x.includes('Check the target cohort')));
});

test('inline mode leaves A and B without Skill bodies or a delivery record', async t => {
  for (const condition of ['A', 'B'] as const) {
    const f = await fixture(t);
    const request = { ...f.request, condition, context: { ...f.request.context, skills: [], wiki: condition === 'A' ? [] : f.request.context.wiki } };
    const run: typeof runProcess = async (command, process) => {
      if (!command.includes('--version')) assert(!Object.hasOwn(JSON.parse(process.input), 'skill_documents'));
      return result(command.includes('--version') ? '2.1.325' : response);
    };
    await invokeClaude(request, options, { cwd: f.cwd, env: { ANTHROPIC_API_KEY: 'fixture' }, run });
    await assert.rejects(readFile(path.join(f.cwd, 'skill-delivery.json')), /ENOENT/);
  }
});

test('missing references, empty or invalid text, oversized files and escaping links fail before auth or model work', async t => {
  for (const invalid of ['missing-reference', 'unlisted-reference', 'cycle', 'empty', 'utf8', 'nul', 'large', 'outside-link']) {
    const f = await fixture(t), file = path.join(f.cwd, 'context/skills/PROJECT.md');
    if (invalid === 'missing-reference') await writeFile(file, '# Rules\n@absent.md');
    if (invalid === 'unlisted-reference') {
      await writeFile(file, '# Rules\n@absent.md');
      await writeFile(path.join(f.cwd, 'context/skills/absent.md'), 'This existing file is not in the request');
    }
    if (invalid === 'cycle') await writeFile(file, '# Rules\n@CLAUDE.md');
    if (invalid === 'empty') await writeFile(file, '  ');
    if (invalid === 'utf8') await writeFile(file, Buffer.from([0xff, 0xff]));
    if (invalid === 'nul') await writeFile(file, 'rules\0hidden');
    if (invalid === 'large') await writeFile(file, 'x'.repeat(64 * 1024 + 1));
    if (invalid === 'outside-link') { await rm(file); await symlink('/etc/hosts', file); }
    let calls = 0;
    const run: typeof runProcess = async () => { calls++; return result(response); };
    await assert.rejects(invokeClaude(f.request, options, { cwd: f.cwd, env: { ANTHROPIC_API_KEY: 'fixture' }, run }));
    assert.equal(calls, 0, invalid);
  }
});

test('the total inline size limit stops before invocation instead of trimming required documents', async t => {
  const f = await fixture(t);
  const skills: string[] = [];
  for (let i = 0; i < 5; i++) {
    const name = `context/skills/large-${i}.md`;
    await writeFile(path.join(f.cwd, name), 'x'.repeat(64 * 1024));
    skills.push(name);
  }
  let calls = 0;
  const run: typeof runProcess = async () => { calls++; return result(response); };
  await assert.rejects(invokeClaude({ ...f.request, context: { ...f.request.context, skills } }, options,
    { cwd: f.cwd, env: { ANTHROPIC_API_KEY: 'fixture' }, run }), /256 KiB/);
  assert.equal(calls, 0);
});

test('a delivery record cannot be overwritten and inline delivery cannot claim mandatory tool reads', async t => {
  assert.throws(() => buildCommand({ ...options, requireSkillReads: true }));
  assert.throws(() => buildCommand({ ...options, traceTools: false }));
  for (const link of [false, true]) {
    const f = await fixture(t);
    const target = path.join(f.cwd, 'keep.txt'), record = path.join(f.cwd, 'skill-delivery.json');
    await writeFile(target, 'keep');
    if (link) await symlink(target, record); else await writeFile(record, 'keep');
    let modelCalls = 0;
    const run: typeof runProcess = async command => { if (!command.includes('--version')) modelCalls++; return result(command.includes('--version') ? '2.1.325' : response); };
    await assert.rejects(invokeClaude(f.request, options, { cwd: f.cwd, env: { ANTHROPIC_API_KEY: 'fixture' }, run }), /fresh skill-delivery/);
    assert.equal(modelCalls, 0);
    assert.equal(await readFile(target, 'utf8'), 'keep');
    assert.equal(await readFile(record, 'utf8'), 'keep');
  }
});
