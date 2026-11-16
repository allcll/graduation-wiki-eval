import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { open } from 'node:fs/promises';
import path from 'node:path';
import { digest } from '../json.js';
import { validateSkillContext } from '../skill-context.js';
import { validateRequest } from './request.js';

export type SkillDelivery = 'tools' | 'inline';
const maxFileBytes = 64 * 1024;
const maxTotalBytes = 256 * 1024;
const hash = (bytes: Uint8Array) => 'sha256:' + createHash('sha256').update(bytes).digest('hex');

async function readSkill(file: string): Promise<Buffer> {
  const handle = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size > maxFileBytes) throw new Error('Inline Skill must be a regular file of at most 64 KiB');
    const buffer = Buffer.alloc(maxFileBytes + 1);
    let size = 0;
    while (size < buffer.length) {
      const next = await handle.read(buffer, size, buffer.length - size, size);
      if (!next.bytesRead) break;
      size += next.bytesRead;
    }
    if (size > maxFileBytes) throw new Error('Inline Skill exceeds 64 KiB');
    return buffer.subarray(0, size);
  } finally { await handle.close(); }
}

/** Prepare exactly the stdin payload used by the Claude adapter, without an
 * executable, authentication, network access, or a model dependency. */
export async function prepareClaudePayload(value: unknown, mode: SkillDelivery, cwd: string) {
  const request = await validateRequest(value, cwd);
  const documents: { path: string; content: string }[] = [];
  const files: { path: string; bytes: number; sha256: string }[] = [];
  let totalBytes = 0;
  if (mode === 'inline' && request.condition === 'C') {
    if (request.context.skills.length > 32) throw new Error('Inline Skill bundle exceeds 32 files');
    const buffers = new Map<string, Uint8Array>();
    for (const file of request.context.skills) {
      const bytes = await readSkill(path.join(cwd, file));
      totalBytes += bytes.length;
      if (totalBytes > maxTotalBytes) throw new Error('Inline Skill bundle exceeds 256 KiB');
      const content = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
      if (!content.trim() || content.includes('\0')) throw new Error('Inline Skill must contain nonempty UTF-8 text without NUL');
      documents.push({ path: file, content });
      files.push({ path: file, bytes: bytes.length, sha256: hash(bytes) });
      buffers.set(file, bytes);
    }
    // Every listed Skill is mandatory; missing/cyclic @ imports fail closed.
    // References are resolved only among these bytes, never fetched from disk.
    validateSkillContext(buffers, request.context.skills,
      { entrypoints: request.context.skills, required_files: request.context.skills }, 'real');
  }
  const input = JSON.stringify({ question: request.question, inputs: request.inputs, context: request.context,
    instructions: request.instructions, output_contract: request.output_contract,
    ...(documents.length ? { skill_documents: documents } : {}) });
  const delivery = documents.length ? {
    schema: 'graduation-wiki-eval/skill-delivery-v1' as const, mode: 'inline' as const,
    stage: 'prepared_for_stdin' as const, request_sha256: digest(request),
    model_input_sha256: hash(Buffer.from(input)), documents_sha256: digest(documents),
    files, total_bytes: totalBytes,
    note: 'Complete listed Skill text is included in the prepared stdin payload. This is not a tool-read trace, server receipt, or proof of understanding.',
  } : undefined;
  return { request, input, delivery };
}
