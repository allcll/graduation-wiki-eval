import path from 'node:path';
import { digest, parseJson } from '../json.js';
import type { AdapterRequest } from './request.js';

type ObjectValue = Record<string, unknown>;
const object = (value: unknown): ObjectValue | undefined => value !== null && typeof value === 'object' && !Array.isArray(value) ? value as ObjectValue : undefined;
const integer = (value: unknown): number | null => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null;
const blocks = (event: ObjectValue): unknown[] => {
  const content = object(event['message'])?.['content'];
  return Array.isArray(content) ? content : [];
};

interface ToolCall {
  sequence: number;
  tool: 'Read' | 'Grep' | 'Glob' | 'other';
  path: string | null;
  path_scope: 'listed_file' | 'context_directory' | 'job_root' | 'unlisted' | 'unspecified';
  requested: { offset: number | null; limit: number | null; pages: string | null };
  status: 'pending' | 'success' | 'error' | 'conflict';
  delivery: 'text' | 'pdf' | 'parts' | 'image' | 'notebook' | 'cache' | 'unverified';
  delivered_lines: { start: number | null; count: number | null; total: number | null; truncated: boolean | null } | null;
  delivered_pages: { start: number; count: number } | null;
  matched_files: string[];
  result_sha256: string | null;
}

/** Retain tool evidence, not the transcript: no thinking, source text, search
 * patterns, authentication events, session IDs, or arbitrary host paths. */
export function summarizeClaudeStream(stdout: string, request: AdapterRequest, cwd: string) {
  const allowed = new Set(Object.values(request.context).flat());
  const calls = new Map<string, ToolCall>();
  const signatures = new Map<string, string>();
  const issues = new Set<string>();
  let finalResult: unknown;
  let resultCount = 0;
  let events = 0;
  const locate = (value: unknown): Pick<ToolCall, 'path' | 'path_scope'> => {
    if (typeof value !== 'string' || !value) return { path: null, path_scope: 'unspecified' };
    const relative = path.relative(cwd, path.resolve(cwd, value)).split(path.sep).join('/');
    if (allowed.has(relative)) return { path: relative, path_scope: 'listed_file' };
    if (relative === '') return { path: '.', path_scope: 'job_root' };
    if (relative.startsWith('context/') && [...allowed].some(file => file.startsWith(relative + '/'))) {
      return { path: relative, path_scope: 'context_directory' };
    }
    return { path: null, path_scope: 'unlisted' };
  };
  for (const line of stdout.split(/\r?\n/)) {
    if (!line.trim()) continue;
    let event: ObjectValue | undefined;
    try { event = object(parseJson(line)); } catch { issues.add('invalid_json_event'); continue; }
    if (!event || typeof event['type'] !== 'string') { issues.add('invalid_event'); continue; }
    events++;
    if (event['type'] === 'result') { finalResult = event; resultCount++; continue; }
    if (event['type'] !== 'assistant' && event['type'] !== 'user') continue;
    if (event['parent_tool_use_id'] != null || event['agent_id'] != null) {
      issues.add('nested_agent_events_unsupported'); continue;
    }
    for (const value of blocks(event)) {
      const block = object(value);
      if (!block) continue;
      if (event['type'] === 'assistant' && block['type'] === 'tool_use') {
        const id = block['id'];
        if (typeof id !== 'string' || !id) { issues.add('invalid_tool_id'); continue; }
        const signature = digest(block);
        if (calls.has(id)) {
          if (signatures.get(id) !== signature) { issues.add('conflicting_tool_call'); calls.get(id)!.status = 'conflict'; }
          continue;
        }
        signatures.set(id, signature);
        const input = object(block['input']) ?? {};
        const tool = block['name'] === 'Read' || block['name'] === 'Grep' || block['name'] === 'Glob' ? block['name'] : 'other';
        const pages = input['pages'];
        calls.set(id, {
          sequence: calls.size + 1, tool, ...locate(tool === 'Read' ? input['file_path'] : input['path']),
          requested: { offset: integer(input['offset']), limit: integer(input['limit']), pages: typeof pages === 'string' && /^\d+(?:-\d+)?$/.test(pages) ? pages : null },
          status: 'pending', delivery: 'unverified', delivered_lines: null, delivered_pages: null, matched_files: [], result_sha256: null,
        });
      }
      if (event['type'] !== 'user' || block['type'] !== 'tool_result') continue;
      const id = block['tool_use_id'];
      const call = typeof id === 'string' ? calls.get(id) : undefined;
      if (!call) { issues.add('orphan_tool_result'); continue; }
      const resultHash = digest(block);
      if (call.result_sha256 !== null) {
        if (call.result_sha256 !== resultHash) { issues.add('conflicting_tool_result'); call.status = 'conflict'; }
        continue;
      }
      call.result_sha256 = resultHash;
      if (call.status === 'conflict') continue;
      call.status = block['is_error'] === true ? 'error' : 'success';
      if (call.status === 'error') continue;
      const structured = object(event['tool_use_result']);
      const file = object(structured?.['file']);
      if (call.tool === 'Read' && file && call.path_scope === 'listed_file') {
        const returned = locate(file['filePath']);
        if (returned.path !== call.path) { issues.add('read_result_path_mismatch'); continue; }
        const kind = structured?.['type'];
        if (kind === 'text' && typeof file['content'] === 'string' && (integer(file['numLines']) ?? 0) > 0) {
          call.delivery = 'text';
          call.delivered_lines = { start: integer(file['startLine']), count: integer(file['numLines']), total: integer(file['totalLines']),
            truncated: typeof file['truncatedByTokenCap'] === 'boolean' ? file['truncatedByTokenCap'] : null };
        } else if (kind === 'pdf' || kind === 'image' || kind === 'notebook') call.delivery = kind;
        else if (kind === 'parts' && (integer(file['count']) ?? 0) > 0) {
          call.delivery = 'parts';
          const start = integer(structured?.['firstPage']);
          const count = integer(file['count']);
          // Requested pages are not evidence of delivery. Require the returned
          // page metadata AND the corresponding image blocks, without storing bytes.
          const images = Array.isArray(block['content']) ? block['content'].filter(value => {
            const image = object(value);
            const source = object(image?.['source']);
            return image?.['type'] === 'image' && source?.['type'] === 'base64'
              && typeof source['data'] === 'string' && source['data'].length > 0;
          }).length : 0;
          if (start !== null && start >= 1 && count !== null && count > 0 && images === count) {
            call.delivered_pages = { start, count };
          }
        }
        else if (kind === 'file_unchanged') call.delivery = 'cache';
      }
      if ((call.tool === 'Grep' || call.tool === 'Glob') && Array.isArray(structured?.['filenames'])) {
        call.matched_files = [...new Set(structured['filenames'].flatMap(value => {
          const found = locate(value);
          return found.path_scope === 'listed_file' && found.path !== null ? [found.path] : [];
        }))].sort();
      }
    }
  }
  if (resultCount !== 1) issues.add('missing_or_duplicate_final_result');
  if ([...calls.values()].some(call => call.status === 'pending')) issues.add('unresolved_tool_calls');
  const tools = [...calls.values()];
  const deliveredReads = tools.filter(call => call.tool === 'Read' && call.status === 'success' && call.path !== null && call.delivery !== 'unverified' && call.delivery !== 'cache');
  const fullyReadFiles = [...allowed].filter(file => {
    const ranges = deliveredReads.filter(call => call.path === file && call.delivery === 'text')
      .flatMap(call => call.delivered_lines ? [call.delivered_lines] : [])
      .filter((range): range is { start: number; count: number; total: number; truncated: boolean | null } =>
        range.start !== null && range.start >= 1 && range.count !== null && range.count > 0 && range.total !== null && range.total > 0
        && range.start + range.count - 1 <= range.total && range.truncated !== true);
    const total = ranges[0]?.total;
    if (!total || ranges.some(range => range.total !== total)) return false;
    let covered = 0;
    for (const range of ranges.sort((a, b) => a.start - b.start)) {
      if (range.start > covered + 1) return false;
      covered = Math.max(covered, range.start + range.count - 1);
    }
    return covered === total;
  }).sort();
  return {
    result: finalResult,
    trace: {
      schema: 'graduation-wiki-eval/claude-tools-v1' as const,
      request_sha256: digest(request),
      complete: issues.size === 0,
      event_count: events,
      issues: [...issues].sort(),
      calls: tools,
      read_files: [...new Set(deliveredReads.map(call => call.path!))].sort(),
      fully_read_files: fullyReadFiles,
      note: 'Read files require a successful tool result with recognized delivery metadata. Partial reads are not full-file coverage or proof of understanding. Search matches and cache replies are separate.',
    },
  };
}

export type ClaudeToolTrace = ReturnType<typeof summarizeClaudeStream>['trace'];
