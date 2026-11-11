import { mkdir, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { digest } from './json.js';

export async function writeJson(path: string, value: unknown, exclusive = false): Promise<void> {
  digest(value);
  await mkdir(dirname(path), { recursive: true });
  const text = JSON.stringify(value, null, 2) + '\n';
  if (exclusive) {
    await writeFile(path, text, { encoding: 'utf8', flag: 'wx' });
    return;
  }
  const temporary = `${path}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, text, { encoding: 'utf8', flag: 'wx' });
    await rename(temporary, path);
  } finally {
    await rm(temporary, { force: true });
  }
}

export function isMain(url: string): boolean {
  const entry = process.argv[1];
  if (!entry) return false;
  try { return realpathSync(resolve(entry)) === realpathSync(fileURLToPath(url)); }
  catch { return false; }
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Unknown error';
}
