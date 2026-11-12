import { z } from 'zod';

export const HARNESS_VERSION = 'graduation-wiki-eval/0.3';
export const PLAN_SCHEMA = 'graduation-wiki-eval/plan-v3';
export const METRIC_KEYS = ['elapsed_ms', 'input_tokens', 'output_tokens'] as const;
export const VERSION_KEYS = ['model', 'model_config', 'prompt', 'source', 'code', 'data', 'wiki', 'skill', 'dataset', 'tools', 'runtime', 'harness'] as const;

export type JsonValue = null | boolean | number | string | JsonValue[] | JsonObject;
export interface JsonObject { [key: string]: JsonValue }
const checkObjectKeys = (value: unknown, ctx: z.RefinementCtx): unknown => {
  if (typeof value === 'object' && value !== null && Object.hasOwn(value, '__proto__')) ctx.addIssue({ code: 'custom', message: 'Reserved JSON key: __proto__' });
  return value;
};
export const jsonValueSchema: z.ZodType<JsonValue> = z.lazy(() => z.union([
  z.null(), z.boolean(), z.number().finite(), z.string(), z.array(jsonValueSchema), z.preprocess(checkObjectKeys, z.record(z.string(), jsonValueSchema)),
]));
export const jsonObjectSchema = z.preprocess(checkObjectKeys, z.record(z.string(), jsonValueSchema));
export const conditionSchema = z.enum(['A', 'B', 'C']);
export const splitSchema = z.enum(['dev', 'holdout']);
const nonempty = z.string().refine(value => value.trim().length > 0, 'Must not be blank');
const hash = z.string().regex(/^sha256:[0-9a-f]{64}$/);
const actionSchema = z.enum(['answer', 'clarify', 'escalate']);
const verdictSchema = z.enum(['pass', 'fail', 'pending']);
const metric = z.number().finite().nonnegative().nullable();

export const criterionSchema = z.strictObject({
  id: nonempty, dimension: z.enum(['answer', 'evidence']), description: nonempty,
});
export const rubricSchema = z.strictObject({
  version: nonempty, criteria: z.array(criterionSchema).min(2),
}).superRefine((value, ctx) => {
  if (new Set(value.criteria.map(item => item.id)).size !== value.criteria.length) ctx.addIssue({ code: 'custom', message: 'Duplicate rubric criterion id', path: ['criteria'] });
  for (const dimension of ['answer', 'evidence'] as const) {
    if (!value.criteria.some(item => item.dimension === dimension)) ctx.addIssue({ code: 'custom', message: `Rubric requires ${dimension} criteria`, path: ['criteria'] });
  }
});
export const criterionResultSchema = z.strictObject({
  criterion_id: nonempty, verdict: verdictSchema, rationale: z.string(),
}).superRefine((value, ctx) => {
  if (value.verdict !== 'pending' && !value.rationale.trim()) ctx.addIssue({ code: 'custom', message: 'Completed criterion requires a rationale', path: ['rationale'] });
});

export const caseSchema = z.strictObject({
  id: nonempty, family: nonempty, split: splitSchema,
  origin: z.enum(['real', 'synthetic']), review_status: z.enum(['draft', 'verified']),
  oracle_reviewer: nonempty.nullable().optional(), independent_reference: z.boolean(),
  question: nonempty, inputs: jsonObjectSchema.optional(), tags: z.array(nonempty).optional(),
  expected: z.strictObject({ action: actionSchema, facts: jsonObjectSchema }),
  rubric: rubricSchema,
  sources: z.array(z.strictObject({ id: nonempty, version: nonempty, locator: nonempty, excerpt: nonempty, authoritative: z.boolean() })).min(1),
}).superRefine((value, ctx) => {
  if (value.review_status === 'verified' && !value.oracle_reviewer) ctx.addIssue({ code: 'custom', message: 'Verified oracle requires a reviewer', path: ['oracle_reviewer'] });
  if (new Set(value.sources.map(source => source.id)).size !== value.sources.length) ctx.addIssue({ code: 'custom', message: 'Duplicate source id', path: ['sources'] });
});

export const outputSchema = z.object({
  action: actionSchema, facts: jsonObjectSchema, answer_text: nonempty, citations: z.array(z.string()).optional(),
}).catchall(jsonValueSchema);
export const versionsSchema = z.object({
  model: nonempty, model_config: nonempty, prompt: nonempty, source: nonempty, code: nonempty,
  data: nonempty, wiki: nonempty, skill: nonempty, dataset: hash, tools: nonempty,
  runtime: nonempty, harness: z.literal(HARNESS_VERSION),
}).catchall(nonempty);
const runBase = {
  run_id: nonempty, case_id: nonempty, condition: conditionSchema, repeat: z.number().int().positive(),
  execution: z.enum(['real', 'synthetic']), started_at: nonempty, case_sha256: hash,
  versions: versionsSchema, plan_sha256: hash.optional(),
  elapsed_ms: metric.optional(), input_tokens: metric.optional(), output_tokens: metric.optional(),
};
export const runSchema = z.discriminatedUnion('status', [
  z.strictObject({ ...runBase, status: z.literal('ok'), output: outputSchema, output_sha256: hash }),
  z.strictObject({ ...runBase, status: z.literal('error'), error: nonempty }),
]);
export const reviewSchema = z.strictObject({
  run_id: nonempty, case_sha256: hash, output_sha256: hash, rubric_sha256: hash, reviewer_kind: z.literal('human'),
  reviewer_id: nonempty, reviewed_at: nonempty, criterion_results: z.array(criterionResultSchema).min(2),
}).superRefine((value, ctx) => {
  if (new Set(value.criterion_results.map(item => item.criterion_id)).size !== value.criterion_results.length) ctx.addIssue({ code: 'custom', message: 'Duplicate criterion result', path: ['criterion_results'] });
});
export const planSchema = z.strictObject({
  schema: z.literal(PLAN_SCHEMA), dataset_sha256: hash,
  conditions: z.array(conditionSchema).min(1), repeats: z.number().int().positive(),
  cases: z.array(z.strictObject({ case_id: nonempty, case_sha256: hash, rubric_sha256: hash, split: splitSchema })).min(1),
});
const diagnosticSchema = z.strictObject({
  field: nonempty, reason: nonempty, expected: jsonValueSchema.optional(), actual: jsonValueSchema.optional(), actual_present: z.boolean().optional(),
});
const metricsSchema = z.strictObject({ elapsed_ms: metric, input_tokens: metric, output_tokens: metric });
export const rowSchema = z.strictObject({
  case_id: nonempty, case_sha256: hash, split: splitSchema, condition: conditionSchema, repeat: z.number().int().positive(),
  rubric: rubricSchema, rubric_sha256: hash,
  run_id: nonempty.nullable(), missing: z.boolean(), error: z.boolean(), unreviewed: z.boolean(),
  synthetic: z.boolean(), oracle_ready: z.boolean(), versions: versionsSchema.nullable(),
  objective: z.boolean().nullable(), objective_details: z.array(diagnosticSchema),
  answer: verdictSchema, evidence: verdictSchema, output_sha256: hash.nullable(),
  review: reviewSchema.nullable(), metrics: metricsSchema,
});
const count = z.number().int().nonnegative();
export const countsSchema = z.strictObject({
  expected: count, missing: count, error: count, unreviewed: count, objective_pass: count, objective_fail: count,
  evidence_fail: count, answer_fail: count, reviewed_success: count, synthetic: count,
  reviewed_success_rate: z.number().min(0).max(1).nullable(),
});
const gateSchema = z.strictObject({ gate: z.enum(['PASS', 'FAIL', 'INCONCLUSIVE']), reasons: z.array(z.string()), holdout_counts: countsSchema });
const metricSummarySchema = z.strictObject({ sum: z.number().finite().nonnegative(), measured_runs: count, expected_runs: count });
const conditionMetricsSchema = z.strictObject({ elapsed_ms: metricSummarySchema, input_tokens: metricSummarySchema, output_tokens: metricSummarySchema });
export const reportSchema = z.strictObject({
  harness: z.literal(HARNESS_VERSION), dataset_sha256: hash, policy: nonempty, plan: planSchema, plan_sha256: hash,
  label: nonempty, gate_scope: nonempty, overall_counts: countsSchema,
  condition_counts: z.record(z.string(), countsSchema), gates: z.record(z.string(), gateSchema),
  metrics: z.record(z.string(), conditionMetricsSchema), rows: z.array(rowSchema),
});
const transitionSchema = z.enum(['improved', 'regressed', 'unchanged_pass', 'unchanged_fail']);
export const comparisonSchema = z.strictObject({
  status: z.enum(['INCONCLUSIVE', 'COMPARABLE']), condition: conditionSchema, split: splitSchema,
  label: nonempty, planned_pairs: count, comparable_pairs: count, reasons: z.array(z.string()),
  counts: z.strictObject({ improved: count, regressed: count, unchanged_pass: count, unchanged_fail: count }),
  transitions: z.array(z.strictObject({ case_id: nonempty, repeat: z.number().int().positive(), transition: transitionSchema })),
});

export type Condition = z.infer<typeof conditionSchema>;
export type Split = z.infer<typeof splitSchema>;
export type Case = z.infer<typeof caseSchema>;
export type Output = z.infer<typeof outputSchema>;
export type Versions = z.infer<typeof versionsSchema>;
export type Run = z.infer<typeof runSchema>;
export type Review = z.infer<typeof reviewSchema>;
export type Rubric = z.infer<typeof rubricSchema>;
export type Criterion = z.infer<typeof criterionSchema>;
export type CriterionResult = z.infer<typeof criterionResultSchema>;
export type EvaluationPlan = z.infer<typeof planSchema>;
export type Diagnostic = z.infer<typeof diagnosticSchema>;
export type Row = z.infer<typeof rowSchema>;
export type Counts = z.infer<typeof countsSchema>;
export type Gate = z.infer<typeof gateSchema>;
export type Report = z.infer<typeof reportSchema>;
export type Comparison = z.infer<typeof comparisonSchema>;

export function parseCases(value: unknown): Case[] {
  const cases = z.array(caseSchema).min(1).parse(value);
  const ids = new Set<string>();
  const families = new Map<string, Split>();
  for (const item of cases) {
    if (ids.has(item.id)) throw new Error(`Duplicate case id: ${item.id}`);
    ids.add(item.id);
    const split = families.get(item.family);
    if (split !== undefined && split !== item.split) throw new Error(`Family leakage across dev/holdout: ${item.family}`);
    families.set(item.family, item.split);
  }
  return cases;
}
export function parseRuns(value: unknown): Run[] { return z.array(runSchema).parse(value); }
export function parseReviews(value: unknown): Review[] { return z.array(reviewSchema).parse(value); }
