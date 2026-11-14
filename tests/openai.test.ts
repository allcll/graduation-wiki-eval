import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildOpenAIRequest, invokeOpenAI, parseOpenAIResponse } from '../src/adapters/openai.js';
import type { AdapterRequest } from '../src/adapters/request.js';

const options = { model: 'test-model', maxOutputTokens: 512 };
const answer = { action: 'answer', facts_json: '{"credits":3,"eligible":false,"missing":["year"]}', answer_text: 'Fictional answer', citations: ['context/sources/source.md'] };
function response(changes: Record<string, unknown> = {}) {
  return { id: 'resp_test', model: 'test-model-snapshot', status: 'completed',
    output: [{ type: 'reasoning' }, { type: 'message', content: [{ type: 'output_text', text: JSON.stringify(answer) }] }],
    usage: { input_tokens: 100, output_tokens: 25, output_tokens_details: { reasoning_tokens: 5 } }, ...changes };
}
async function fixture(t: TestContext) {
  const cwd = await mkdtemp(join(tmpdir(), 'openai-adapter-'));
  t.after(() => rm(cwd, { recursive: true, force: true }));
  for (const group of ['sources', 'wiki', 'skills']) {
    await mkdir(join(cwd, 'context', group), { recursive: true });
    await writeFile(join(cwd, 'context', group, 'source.md'), `FICTIONAL ${group}`);
  }
  await writeFile(join(cwd, 'answer-key.json'), 'GOLD_SECRET');
  const request: AdapterRequest = { job_id: 'test', case_id: 'fictional', condition: 'A', question: 'Return credits and eligible.', inputs: { year: 2026 },
    context: { sources: ['context/sources/source.md'], wiki: [], skills: [] }, instructions: 'Same task instructions', output_contract: {} };
  return { cwd, request };
}

test('A/B/C inline only their allowlisted text and use the same output contract without gold', async t => {
  const { cwd, request } = await fixture(t);
  for (const condition of ['A', 'B', 'C'] as const) {
    const body = await buildOpenAIRequest({ ...request, condition, context: { ...request.context,
      wiki: condition === 'A' ? [] : ['context/wiki/source.md'], skills: condition === 'C' ? ['context/skills/source.md'] : [] } }, options, cwd);
    assert.equal(body.store, false);
    assert.equal(body.truncation, 'disabled');
    assert.equal(body.text.format.strict, true);
    assert.equal(body.max_output_tokens, 512);
    assert.deepEqual(body.tools, []);
    assert.equal(body.input.includes('FICTIONAL wiki'), condition !== 'A');
    assert.equal(body.input.includes('FICTIONAL skills'), condition === 'C');
    assert.ok(!body.input.includes('GOLD_SECRET'));
    assert.ok(!body.input.includes('case_id'));
    assert.ok(!body.input.includes(cwd));
  }
});

test('successful Responses JSON becomes the existing facts contract and actual usage', () => {
  const result = parseOpenAIResponse(response(), options);
  assert.deepEqual(result.output.facts, { credits: 3, eligible: false, missing: ['year'] });
  assert.deepEqual(result.usage, { input_tokens: 100, output_tokens: 25 });
  assert.equal(result.runtime.model, 'test-model-snapshot');
  assert.equal(result.runtime.requested_model, 'test-model');
  assert.equal(result.runtime.response_id, 'resp_test');
});

test('incomplete, refused, malformed and duplicate fact keys do not become passing answers', () => {
  assert.throws(() => parseOpenAIResponse(response({ status: 'incomplete' }), options), /incomplete/);
  assert.throws(() => parseOpenAIResponse(response({ output: [{ type: 'message', content: [{ type: 'refusal' }] }] }), options), /refused/);
  assert.throws(() => parseOpenAIResponse(response({ output: [] }), options), /one structured/);
  for (const facts_json of ['[]', '{"credits":3,"credits":7}', '{"__proto__":{}}', 'not JSON']) {
    assert.throws(() => parseOpenAIResponse(response({ output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify({ ...answer, facts_json }) }] }] }), options), /output contract/);
  }
});

test('one authenticated request with bounded input and no retry; upstream errors stay redacted', async t => {
  const { cwd, request } = await fixture(t);
  let calls = 0;
  const mock: typeof fetch = async (url, init) => {
    calls++;
    assert.equal(url, 'https://api.openai.com/v1/responses');
    assert.equal((init?.headers as Record<string, string>)['Authorization'], 'Bearer fake-test-key');
    assert.equal(init?.redirect, 'error');
    assert.ok(init?.signal);
    return Response.json(response());
  };
  const deps = { cwd, env: { OPENAI_API_KEY: 'fake-test-key' }, fetch: mock };
  await invokeOpenAI(request, options, deps);
  assert.equal(calls, 1);
  await assert.rejects(invokeOpenAI(request, { ...options, maxInputBytes: 1 }, deps), /max-input-bytes/);
  await assert.rejects(invokeOpenAI(request, options, { ...deps, env: {} }), /OPENAI_API_KEY/);
  assert.equal(calls, 1);
  await assert.rejects(invokeOpenAI(request, options, { ...deps, fetch: async () => { calls++; return new Response('SECRET', { status: 429 }); } }), /^OpenAIAdapterError: OpenAI HTTP 429; not retried$/);
  assert.equal(calls, 2);
  await assert.rejects(invokeOpenAI(request, options, { ...deps, fetch: async () => { throw new Error('SECRET'); } }), /^OpenAIAdapterError: OpenAI request failed or timed out; not retried$/);
});

test('PDFs, invalid UTF-8, cross-condition context and oversized responses are rejected', async t => {
  const { cwd, request } = await fixture(t);
  await writeFile(join(cwd, 'context/sources/book.pdf'), '%PDF');
  await assert.rejects(buildOpenAIRequest({ ...request, context: { ...request.context, sources: ['context/sources/book.pdf'] } }, options, cwd), /extract and verify PDF/);
  await writeFile(join(cwd, 'context/sources/source.md'), Buffer.from([0xff, 0xfe]));
  await assert.rejects(buildOpenAIRequest(request, options, cwd), /UTF-8/);
  await assert.rejects(buildOpenAIRequest({ ...request, context: { ...request.context, wiki: ['context/wiki/source.md'] } }, options, cwd), /A cannot include/);
  await writeFile(join(cwd, 'context/sources/source.md'), 'fictional');
  await assert.rejects(invokeOpenAI(request, options, { cwd, env: { OPENAI_API_KEY: 'fake' }, fetch: async () => new Response('x'.repeat(2 * 1024 * 1024 + 1)) }), /exceeds 2 MiB/);
});
