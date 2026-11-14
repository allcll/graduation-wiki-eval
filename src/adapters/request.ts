import { realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import { jsonValueSchema } from '../schema.js';

const groups = ['sources', 'wiki', 'skills'] as const;
const requestSchema = z.strictObject({
  job_id: z.string().trim().min(1),
  case_id: z.string().trim().min(1),
  condition: z.enum(['A', 'B', 'C']),
  question: z.string().refine((text) => text.trim().length > 0),
  inputs: z.record(z.string(), jsonValueSchema),
  context: z.strictObject({
    sources: z.array(z.string()).min(1),
    wiki: z.array(z.string()),
    skills: z.array(z.string()),
  }),
  instructions: z.string(),
  output_contract: z.record(z.string(), jsonValueSchema),
});

export const answerSchema = z.strictObject({
  action: z.enum(['answer', 'clarify', 'escalate']),
  facts: z.record(z.string(), jsonValueSchema),
  answer_text: z.string().refine((text) => text.trim().length > 0),
  citations: z.array(z.string()),
});

export type AdapterRequest = z.infer<typeof requestSchema>;
export type AdapterAnswer = z.infer<typeof answerSchema>;
export class AdapterRequestError extends Error {}

export async function validateRequest(value: unknown, cwd: string): Promise<AdapterRequest> {
  const parsed = requestSchema.safeParse(value);
  if (!parsed.success) throw new AdapterRequestError('Invalid runner request');
  const request = parsed.data;
  if (request.condition === 'A' && (request.context.wiki.length > 0 || request.context.skills.length > 0)) {
    throw new AdapterRequestError('A cannot include WIKI or Skill files');
  }
  if (request.condition === 'B' && request.context.skills.length > 0) {
    throw new AdapterRequestError('B cannot include Skill files');
  }
  if (request.condition !== 'A' && request.context.wiki.length === 0) {
    throw new AdapterRequestError('B/C require WIKI files');
  }
  if (request.condition === 'C' && request.context.skills.length === 0) {
    throw new AdapterRequestError('C requires Skill files');
  }
  const root = await realpath(cwd);
  for (const group of groups) {
    const paths = request.context[group];
    if (new Set(paths).size !== paths.length) throw new AdapterRequestError('Duplicate context paths');
    for (const file of paths) {
      const parts = file.split('/');
      if (path.posix.isAbsolute(file) || file.includes('\\') || parts.some((part) => ['', '.', '..'].includes(part)) ||
          parts[0] !== 'context' || parts[1] !== group) {
        throw new AdapterRequestError('Invalid context path');
      }
      const resolved = await realpath(path.join(root, file));
      const relative = path.relative(root, resolved);
      if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative) || !(await stat(resolved)).isFile()) {
        throw new AdapterRequestError('Context file escapes the job directory');
      }
    }
  }
  return request;
}

