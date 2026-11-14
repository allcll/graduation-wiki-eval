#!/usr/bin/env node
/** Fixed responses for protocol tests. This is not a language model. */
import { z } from 'zod';
import { parseJson } from './json.js';
import { isMain } from './io.js';
import type { Output } from './schema.js';

const requestSchema = z.object({ inputs: z.object({
  admission_year: z.number().optional(), completed_credits: z.number().nonnegative().optional(), policy_conflict: z.boolean().optional(),
}) });

export function respond(value: unknown): Output {
  const { inputs } = requestSchema.parse(value);
  if (inputs.admission_year === undefined) return {
    action: 'clarify', facts: { required_fields: ['admission_year'] },
    answer_text: '[합성 예제] 적용 규정을 확인하려면 입학년도가 필요합니다.', citations: [],
  };
  if (inputs.policy_conflict) return {
    action: 'escalate', facts: { reason: 'source_conflict' },
    answer_text: '[합성 예제] 두 규정의 우선순위가 없어 필요한 학점을 확정할 수 없습니다.', citations: ['sample-conflict'],
  };
  if (inputs.completed_credits === undefined) throw new Error('Sample requires completed_credits');
  const remaining = Math.max(0, 120 - inputs.completed_credits);
  return { action: 'answer', facts: { remaining_credits: remaining },
    answer_text: `[합성 예제] 가상 규정의 120학점 기준으로 ${remaining}학점이 부족합니다.`, citations: ['sample-credits'] };
}

if (isMain(import.meta.url)) {
  let input = '';
  for await (const chunk of process.stdin) input += String(chunk);
  process.stdout.write(JSON.stringify(respond(parseJson(input))) + '\n');
}
