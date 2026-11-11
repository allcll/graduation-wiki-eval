import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { access, chmod, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test, type TestContext } from 'node:test';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import {
  buildCommand, ClaudeAdapterError, invokeClaude, parseResponse, validateRequest,
  type ClaudeRequest,
} from '../src/adapters/claude.js';
import { type ProcessResult, runProcess } from '../src/process.js';

function request(): ClaudeRequest {
  return {
    job_id: 'A-1', case_id: 'sample', condition: 'A', question: 'Example', inputs: {},
    context: { sources: ['context/sources/original.md'], wiki: [], skills: [] },
    instructions: 'Use the same facts schema in all conditions', output_contract: {},
  };
}

async function fixture(t: TestContext): Promise<string> {
  const cwd = await mkdtemp(path.join(tmpdir(), 'gradwiki-adapter-test-'));
  t.after(async () => rm(cwd, { recursive: true, force: true }));
  await mkdir(path.join(cwd, 'context/sources'), { recursive: true });
  await writeFile(path.join(cwd, 'context/sources/original.md'), 'Fictional source');
  return cwd;
}

function result(stdout: string, changes: Partial<ProcessResult> = {}): ProcessResult {
  return { stdout, stderr: '', exitCode: 0, signal: null, timedOut: false, outputLimitExceeded: false, ...changes };
}

const answer = { action: 'clarify', facts: { required_fields: ['admission_year'] }, answer_text: 'Which admission year?', citations: [] };
const response = JSON.stringify({ type: 'result', subtype: 'success', is_error: false, structured_output: answer });
const options = { model: 'test-pinned-model', budgetUsd: 0.1 };

test('command fixes read-only tools, context discovery and per-job limits', () => {
  const command = buildCommand(options);
  for (const flag of ['--bare', '--restricted', '--disable-slash-commands', '--strict-mcp-config', '--no-session-persistence']) {
    assert.ok(command.includes(flag));
  }
  assert.equal(command[command.indexOf('--tools') + 1], 'Read,Grep,Glob');
  assert.equal(command[command.indexOf('--permission-mode') + 1], 'dontAsk');
  assert.equal(command[command.indexOf('--max-budget-usd') + 1], '0.1');
  assert.equal(command[command.indexOf('--max-turns') + 1], '12');
  assert.ok(!command.includes('--dangerously-skip-permissions'));
  for (const budgetUsd of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
    assert.throws(() => buildCommand({ ...options, budgetUsd }), ClaudeAdapterError);
  }
  for (const model of ['sonnet', 'opus', 'opusplan', 'SONNET', 'sonnet[1m]', '-bad-flag']) {
    assert.throws(() => buildCommand({ ...options, model }), ClaudeAdapterError);
  }
});

test('only a successful structured response becomes an answer', () => {
  assert.deepEqual(parseResponse(response), answer);
  const invalid = [
    { type: 'result', subtype: 'error', is_error: true },
    { type: 'result', subtype: 'success', is_error: false, result: '```json {} ```' },
    { type: 'result', subtype: 'success', is_error: false, structured_output: { ...answer, answer_text: ' ' } },
    { type: 'result', subtype: 'success', is_error: false, structured_output: { ...answer, evidence_pass: true } },
  ];
  for (const value of invalid) assert.throws(() => parseResponse(JSON.stringify(value)), ClaudeAdapterError);
  assert.throws(() => parseResponse('{"type":"result","type":"other"}'), ClaudeAdapterError);
  assert.throws(() => parseResponse(response.replace('"facts":', '"facts":1e999,"ignored":')), ClaudeAdapterError);
});

test('request validation prevents cross-condition data and path escape', async (t) => {
  const cwd = await fixture(t);
  assert.equal((await validateRequest(request(), cwd)).case_id, 'sample');
  const wikiInA = request();
  wikiInA.context.wiki = ['context/wiki/a.md'];
  await assert.rejects(validateRequest(wikiInA, cwd), /A cannot include/);
  const skillInB = request();
  skillInB.condition = 'B';
  skillInB.context.skills = ['context/skills/a.md'];
  await assert.rejects(validateRequest(skillInB, cwd), /B cannot include/);
  const emptyC = request();
  emptyC.condition = 'C';
  await assert.rejects(validateRequest(emptyC, cwd), /require WIKI/);
  for (const file of ['../answer-key.json', '/etc/passwd', 'context\\sources\\original.md', 'context/sources/../answer-key.json']) {
    const invalid = request();
    invalid.context.sources = [file];
    await assert.rejects(validateRequest(invalid, cwd), /Invalid context path/);
  }
  await assert.rejects(validateRequest({ ...request(), expected: answer }, cwd), /Invalid runner request/);
});

test('context symlinks cannot point outside the job directory', async (t) => {
  const cwd = await fixture(t);
  const outside = await fixture(t);
  await symlink(path.join(outside, 'context/sources/original.md'), path.join(cwd, 'context/sources/outside.md'));
  const invalid = request();
  invalid.context.sources = ['context/sources/outside.md'];
  await assert.rejects(validateRequest(invalid, cwd), /escapes the job directory/);
});

test('invoke forwards common instructions and cleans up its temporary configuration', async (t) => {
  const cwd = await fixture(t);
  const calls: { command: readonly string[]; options: Parameters<typeof runProcess>[1] }[] = [];
  const run: typeof runProcess = async (command, processOptions) => {
    calls.push({ command, options: processOptions });
    return calls.length === 1 ? result('2.1.322 (Claude Code)') : result(response);
  };
  const actual = await invokeClaude(request(), options, { cwd, env: { ANTHROPIC_API_KEY: 'unit-test-only' }, run });
  assert.deepEqual(actual, answer);
  assert.equal(calls.length, 2);
  const modelCall = calls[1];
  assert.ok(modelCall);
  const sent: unknown = JSON.parse(modelCall.options.input);
  assert.ok(typeof sent === 'object' && sent !== null && 'instructions' in sent);
  assert.equal(sent.instructions, request().instructions);
  assert.ok(!modelCall.options.input.includes('unit-test-only'));
  assert.ok(!modelCall.options.input.includes('job_id'));
  const configDir = modelCall.options.env?.['CLAUDE_CONFIG_DIR'];
  assert.ok(configDir);
  await assert.rejects(access(configDir));
});

test('missing credentials prevent process calls', async (t) => {
  const cwd = await fixture(t);
  let calls = 0;
  const run: typeof runProcess = async () => { calls += 1; return result(''); };
  await assert.rejects(invokeClaude(request(), options, { cwd, env: {}, run }), /ANTHROPIC_API_KEY is required/);
  assert.equal(calls, 0);
});

test('unsupported versions stop before model invocation', async (t) => {
  const cwd = await fixture(t);
  for (const version of ['2.1.321', '2.0.999', 'not-a-version']) {
    let calls = 0;
    const run: typeof runProcess = async () => { calls += 1; return result(version); };
    await assert.rejects(invokeClaude(request(), options, { cwd, env: { ANTHROPIC_API_KEY: 'unit-test-only' }, run }), ClaudeAdapterError);
    assert.equal(calls, 1);
  }
});

test('timeout, output limit and exit errors are rejected without relaying stderr', async (t) => {
  const cwd = await fixture(t);
  for (const state of [{ timedOut: true }, { outputLimitExceeded: true }, { exitCode: 7 }] satisfies Partial<ProcessResult>[]) {
    let calls = 0;
    const run: typeof runProcess = async () => {
      calls += 1;
      return calls === 1 ? result('2.1.322') : result(response, { ...state, stderr: 'private upstream text' });
    };
    await assert.rejects(invokeClaude(request(), options, { cwd, env: { ANTHROPIC_API_KEY: 'unit-test-only' }, run }),
      (error: unknown) => error instanceof ClaudeAdapterError && !error.message.includes('private upstream text'));
  }
});

test('a symlinked CLI entry prints help without credentials', async (t) => {
  const cwd = await fixture(t);
  const bin = path.join(cwd, 'grad-eval-claude');
  await symlink(fileURLToPath(new URL('../src/adapters/claude.ts', import.meta.url)), bin);
  const { stdout } = await promisify(execFile)(process.execPath, ['--import', import.meta.resolve('tsx'), bin, '--help'],
    { env: { ...process.env, ANTHROPIC_API_KEY: '' }, timeout: 10_000 });
  assert.match(stdout, /^Usage: grad-eval-claude/u);
});

test('an outer timeout kills a nested Claude process group that ignores SIGTERM', { timeout: 10_000 }, async (t) => {
  const cwd = await fixture(t);
  const binDir = path.join(cwd, 'bin');
  await mkdir(binDir);
  const started = path.join(cwd, 'started');
  const survived = path.join(cwd, 'survived');
  const fakeClaude = path.join(binDir, 'claude');
  const grandchild = `process.on('SIGTERM', () => {}); setTimeout(() => require('node:fs').writeFileSync(${JSON.stringify(survived)}, 'alive'), 2800)`;
  await writeFile(fakeClaude, `#!/usr/bin/env node
const { spawn } = require('node:child_process');
const { writeFileSync } = require('node:fs');
if (process.argv.includes('--version')) {
  console.log('2.1.322');
} else {
  process.on('SIGTERM', () => {});
  writeFileSync(${JSON.stringify(started)}, 'started');
  spawn(process.execPath, ['-e', ${JSON.stringify(grandchild)}], { stdio: 'inherit' });
  setTimeout(() => {}, 20000);
}
`);
  await chmod(fakeClaude, 0o755);
  const command = [process.execPath, '--import', import.meta.resolve('tsx'),
    fileURLToPath(new URL('../src/adapters/claude.ts', import.meta.url)), '--model', 'test-pinned-model',
    '--max-budget-usd', '0.1', '--timeout', '10'];
  const actual = await runProcess(command, { cwd, input: JSON.stringify(request()), timeoutMs: 2000,
    env: { ...process.env, ANTHROPIC_API_KEY: 'unit-test-only', PATH: `${binDir}${path.delimiter}${process.env['PATH'] ?? ''}` } });
  assert.equal(actual.timedOut, true, JSON.stringify(actual));
  assert.equal(await readFile(started, 'utf8'), 'started');
  await new Promise((resolve) => setTimeout(resolve, 3000));
  await assert.rejects(access(survived));
});
