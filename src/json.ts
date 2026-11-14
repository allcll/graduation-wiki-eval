import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import type { JsonValue } from './schema.js';
import { assertJson, canonical, parseJson } from './json-data.js';
export { parseJson } from './json-data.js';

export function digest(value: unknown): string {
  assertJson(value);
  return 'sha256:' + createHash('sha256').update(canonical(value), 'utf8').digest('hex');
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
