import { z } from 'zod';

export const automaticCheckSchema = z.strictObject({
  id: z.string().min(1), verdict: z.enum(['pass', 'fail', 'inconclusive']),
  reason: z.string().min(1), next_action: z.string(),
});
export const automaticEvaluationSchema = z.strictObject({
  schema: z.literal('graduation-wiki-eval/automatic-evaluation-v1'),
  checker_version: z.string().min(1),
  request_sha256: z.string().regex(/^sha256:[a-f0-9]{64}$/),
  output_sha256: z.string().regex(/^sha256:[a-f0-9]{64}$/),
  checks: z.array(automaticCheckSchema),
  semantic_review: z.literal('pending'),
}).refine(value => new Set(value.checks.map(check => check.id)).size === value.checks.length, 'Duplicate automatic check IDs');
export type AutomaticCheck = z.infer<typeof automaticCheckSchema>;
export type AutomaticEvaluation = z.infer<typeof automaticEvaluationSchema>;

export function automaticStatus(checks: readonly AutomaticCheck[]) {
  return checks.some(check => check.verdict === 'fail') ? 'fail' as const
    : checks.some(check => check.verdict === 'inconclusive') ? 'inconclusive' as const : 'pass' as const;
}
export const automaticFailed = (value: AutomaticEvaluation | undefined) => value?.checks.some(check => check.verdict === 'fail') ?? false;
export const automaticPending = (value: AutomaticEvaluation | undefined) => value?.checks.some(check => check.verdict === 'inconclusive') ?? false;
