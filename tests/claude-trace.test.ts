import assert from 'node:assert/strict';
import { test } from 'node:test';
import { summarizeClaudeStream } from '../src/adapters/claude-trace.js';
import type { AdapterRequest } from '../src/adapters/request.js';

const cwd = '/tmp/trace-job';
const source = 'context/sources/handbook.txt';
const skill = 'context/skills/query.md';
const request: AdapterRequest = { job_id: 'C-1', case_id: 'sample', condition: 'C', question: 'A fictional task', inputs: {},
  context: { sources: [source], wiki: ['context/wiki/rule.md'], skills: [skill] }, instructions: '', output_contract: {} };
const use = (id: string, name: string, input: unknown) => ({ type: 'assistant', message: { content: [{ type: 'tool_use', id, name, input }] } });
const reply = (id: string, tool_use_result: unknown, is_error = false) => ({ type: 'user', tool_use_result,
  message: { content: [{ type: 'tool_result', tool_use_id: id, is_error, content: 'PRIVATE SOURCE TEXT' }] } });
const textFile = (filePath: string) => ({ type: 'text', file: { filePath, content: 'PRIVATE SOURCE TEXT', startLine: 4, numLines: 2, totalLines: 40, truncatedByTokenCap: false } });
const final = { type: 'result', subtype: 'success', is_error: false, structured_output: { action: 'answer', facts: {}, answer_text: 'Example.', citations: [] } };
const stream = (...events: unknown[]) => events.map(event => JSON.stringify(event)).join('\n') + '\n';

test('trace binds successful Read results and preserves partial ranges without source text', () => {
  const output = summarizeClaudeStream(stream(
    { type: 'system', email: 'PRIVATE EMAIL', token: 'PRIVATE TOKEN', cwd },
    { type: 'assistant', message: { content: [{ type: 'thinking', thinking: 'PRIVATE THINKING' }] } },
    use('a', 'Read', { file_path: `${cwd}/${skill}`, offset: 4, limit: 2 }), reply('a', textFile(`${cwd}/${skill}`)), final,
  ), request, cwd);
  assert.equal(JSON.stringify(output.result), JSON.stringify(final));
  assert.equal(output.trace.complete, true);
  assert.deepEqual(output.trace.read_files, [skill]);
  assert.deepEqual(output.trace.fully_read_files, []);
  assert.deepEqual(output.trace.calls[0]?.delivered_lines, { start: 4, count: 2, total: 40, truncated: false });
  assert(!JSON.stringify(output.trace).includes('PRIVATE'));
  assert(!JSON.stringify(output.trace).includes(cwd));
});

test('search hits, failed reads, cached replies, and pending reads do not count as delivered files', () => {
  const output = summarizeClaudeStream(stream(
    use('s', 'Grep', { path: '.', pattern: 'PRIVATE QUESTION' }), reply('s', { filenames: [source, '/etc/private-file'] }),
    use('e', 'Read', { file_path: source }), reply('e', textFile(source), true),
    use('c', 'Read', { file_path: skill }), reply('c', { type: 'file_unchanged', file: { filePath: skill } }),
    use('p', 'Read', { file_path: skill }), final,
  ), request, cwd);
  assert.deepEqual(output.trace.read_files, []);
  assert.equal(output.trace.complete, false);
  assert.deepEqual(output.trace.calls.map(call => call.status), ['success', 'error', 'success', 'pending']);
  assert.deepEqual(output.trace.calls[0]?.matched_files, [source]);
  assert(!JSON.stringify(output.trace).includes('PRIVATE'));
  assert(!JSON.stringify(output.trace).includes('/etc/'));
});

test('PDF page delivery is distinct from text lines and unknown Read result shapes remain unverified', () => {
  const output = summarizeClaudeStream(stream(
    use('p', 'Read', { file_path: source, pages: '52-53' }), reply('p', { type: 'parts', file: { filePath: source, count: 2, outputDir: '/tmp/private' } }),
    use('u', 'Read', { file_path: skill }), reply('u', { newShape: 'not understood' }), final,
  ), request, cwd);
  assert.equal(output.trace.calls[0]?.delivery, 'parts');
  assert.equal(output.trace.calls[0]?.requested.pages, '52-53');
  assert.equal(output.trace.calls[1]?.delivery, 'unverified');
  assert.deepEqual(output.trace.read_files, [source]);
});

test('unlisted paths and mismatched delivery paths cannot establish listed-file reads', () => {
  const output = summarizeClaudeStream(stream(
    use('x', 'Read', { file_path: '/Users/private/person.txt' }), reply('x', textFile('/Users/private/person.txt')),
    use('y', 'Read', { file_path: source }), reply('y', textFile(skill)), final,
  ), request, cwd);
  assert.deepEqual(output.trace.read_files, []);
  assert.equal(output.trace.calls[0]?.path_scope, 'unlisted');
  assert.equal(output.trace.calls[0]?.path, null);
  assert(output.trace.issues.includes('read_result_path_mismatch'));
  assert(!JSON.stringify(output.trace).includes('/Users/private'));
});

test('truncated JSON, orphan results and conflicting duplicates keep the trace incomplete', () => {
  for (const input of [stream(final, final), stream(reply('missing', {}), final),
    stream(use('a', 'Read', { file_path: source }), use('a', 'Read', { file_path: skill }), reply('a', textFile(source)), final),
    stream(use('a', 'Read', { file_path: source }), reply('a', textFile(source)), reply('a', {}, true), final),
    stream(final) + '{"type":"assistant"',
  ]) assert.equal(summarizeClaudeStream(input, request, cwd).trace.complete, false);
  const identical = summarizeClaudeStream(stream(use('a', 'Read', { file_path: source }), use('a', 'Read', { file_path: source }), reply('a', textFile(source)), reply('a', textFile(source)), final), request, cwd);
  assert.equal(identical.trace.complete, true);
  assert.equal(identical.trace.calls.length, 1);
});

test('full Read coverage requires contiguous delivered ranges from the same file size', () => {
  const readRange = (id: string, start: number, count: number, total = 4, truncated = false) => [
    use(id, 'Read', { file_path: skill, offset: start, limit: count }),
    reply(id, { type: 'text', file: { filePath: skill, content: 'text', startLine: start, numLines: count, totalLines: total, truncatedByTokenCap: truncated } }),
  ];
  assert.deepEqual(summarizeClaudeStream(stream(...readRange('a', 1, 2), ...readRange('b', 3, 2), final), request, cwd).trace.fully_read_files, [skill]);
  for (const ranges of [
    [...readRange('a', 1, 1), ...readRange('b', 3, 2)],
    [...readRange('a', 1, 2), ...readRange('b', 3, 2, 5)],
    readRange('a', 1, 4, 4, true),
  ]) assert.deepEqual(summarizeClaudeStream(stream(...ranges, final), request, cwd).trace.fully_read_files, []);
});
