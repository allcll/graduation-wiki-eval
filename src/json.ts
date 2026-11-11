import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import type { JsonValue, JsonObject } from './schema.js';

function assertJson(value: unknown, ancestors = new Set<object>()): asserts value is JsonValue {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return;
  if (typeof value === 'number' && Number.isFinite(value)) return;
  if (typeof value !== 'object' || value === null) throw new Error('Expected finite JSON data');
  if (ancestors.has(value)) throw new Error('Circular JSON data');
  ancestors.add(value);
  if (Array.isArray(value)) {
    for (const item of value) assertJson(item, ancestors);
  } else {
    if (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) throw new Error('Expected a plain JSON object');
    if (Reflect.ownKeys(value).some(key => typeof key !== 'string')) throw new Error('JSON object keys must be strings');
    if (Object.hasOwn(value, '__proto__')) throw new Error('Reserved JSON key: __proto__');
    for (const item of Object.values(value)) assertJson(item, ancestors);
  }
  ancestors.delete(value);
}

function canonical(value: JsonValue): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  return '{' + Object.keys(value).sort().map(key => {
    const child = value[key];
    if (child === undefined) throw new Error('Undefined is not JSON');
    return JSON.stringify(key) + ':' + canonical(child);
  }).join(',') + '}';
}

export function digest(value: unknown): string {
  assertJson(value);
  return 'sha256:' + createHash('sha256').update(canonical(value), 'utf8').digest('hex');
}

/** JSON.parse silently accepts duplicate keys; evaluation records must not. */
export function parseJson(text: string): JsonValue {
  let offset = 0;
  const fail = (message: string): never => { throw new Error(`${message} at JSON offset ${offset}`); };
  const space = (): void => { while (/[ \t\r\n]/.test(text[offset] ?? '') && offset < text.length) offset++; };
  const string = (): string => {
    const start = offset++;
    while (offset < text.length) {
      const char = text[offset++];
      if (char === '\\') offset++;
      else if (char === '"') {
        const value: unknown = JSON.parse(text.slice(start, offset));
        if (typeof value !== 'string') return fail('Expected a string');
        return value;
      }
    }
    return fail('Unterminated string');
  };
  const value = (depth: number): JsonValue => {
    if (depth > 256) return fail('JSON nesting limit exceeded');
    space();
    const char = text[offset];
    if (char === '"') return string();
    if (char === '{') {
      offset++; space();
      const result: JsonObject = Object.create(null);
      if (text[offset] === '}') { offset++; return result; }
      while (true) {
        space();
        if (text[offset] !== '"') return fail('Expected object key');
        const key = string();
        if (key === '__proto__') return fail('Reserved JSON key: __proto__');
        if (Object.hasOwn(result, key)) return fail(`Duplicate JSON key ${key}`);
        space();
        if (text[offset++] !== ':') return fail('Expected colon');
        result[key] = value(depth + 1); space();
        const delimiter = text[offset++];
        if (delimiter === '}') return result;
        if (delimiter !== ',') return fail('Expected comma or closing brace');
      }
    }
    if (char === '[') {
      offset++; space();
      const result: JsonValue[] = [];
      if (text[offset] === ']') { offset++; return result; }
      while (true) {
        result.push(value(depth + 1)); space();
        const delimiter = text[offset++];
        if (delimiter === ']') return result;
        if (delimiter !== ',') return fail('Expected comma or closing bracket');
      }
    }
    for (const [literal, result] of [['true', true], ['false', false], ['null', null]] as const) {
      if (text.startsWith(literal, offset)) { offset += literal.length; return result; }
    }
    const number = /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/.exec(text.slice(offset));
    if (number) {
      offset += number[0].length;
      const result = Number(number[0]);
      if (!Number.isFinite(result)) return fail('Nonfinite JSON number');
      return result;
    }
    return fail('Invalid JSON value');
  };
  const parsed = value(0); space();
  if (offset !== text.length) fail('Unexpected trailing data');
  return parsed;
}

export async function readJson(path: string | URL): Promise<JsonValue> {
  return parseJson(await readFile(path, 'utf8'));
}
export async function readRecords(path: string | URL): Promise<JsonValue[]> {
  const text = await readFile(path, 'utf8');
  const value = String(path).endsWith('.jsonl') ? text.split(/\r?\n/).filter(line => line.trim()).map(parseJson) : parseJson(text);
  if (!Array.isArray(value)) throw new Error('Expected a JSON array or JSONL records');
  return value;
}
export async function writeRecords(path: string | URL, records: readonly unknown[]): Promise<void> {
  const lines = records.map(record => { assertJson(record); return JSON.stringify(record); });
  await writeFile(path, lines.length ? lines.join('\n') + '\n' : '', 'utf8');
}
