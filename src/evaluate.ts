import { z } from 'zod';
import { digest } from './json.js';
import { summarizeReview } from './review.js';
import {
  HARNESS_VERSION, PLAN_SCHEMA, METRIC_KEYS, conditionSchema, planSchema, reportSchema,
  parseCases, parseRuns, parseReviews,
  type Case, type Run, type Review, type Condition, type EvaluationPlan, type Report,
  type Row, type Counts, type Gate, type Diagnostic, type Output,
} from './schema.js';

const POLICY = 'Project-defined pilot gate; not enterprise certification or statistical proof.';
export function ensure(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}
function same(left: unknown, right: unknown): boolean { return digest(left) === digest(right); }
function sortedCases(cases: Case[]): Case[] { return [...cases].sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0); }
export function datasetHash(cases: Case[]): string { return digest(sortedCases(parseCases(cases))); }

export function parsePlan(value: unknown): EvaluationPlan {
  const plan = planSchema.parse(value);
  ensure(new Set(plan.conditions).size === plan.conditions.length, 'Duplicate planned conditions');
  ensure(same(plan.conditions, [...plan.conditions].sort()), 'Plan conditions must be canonical');
  const ids = plan.cases.map(item => item.case_id);
  ensure(new Set(ids).size === ids.length && same(ids, [...ids].sort()), 'Planned case ids must be unique and canonical');
  return plan;
}

export function makePlan(cases: Case[], conditions: Condition[] = ['A', 'B', 'C'], repeats = 1): EvaluationPlan {
  const checked = parseCases(cases);
  const selections = z.array(conditionSchema).min(1).parse(conditions);
  return parsePlan({ schema: PLAN_SCHEMA, dataset_sha256: datasetHash(checked),
    conditions: [...selections].sort(), repeats,
    cases: sortedCases(checked).map(item => ({ case_id: item.id, case_sha256: digest(item), rubric_sha256: digest(item.rubric), split: item.split })),
  });
}

export function validatePlan(plan: unknown, cases: Case[]): EvaluationPlan {
  const checked = parsePlan(plan);
  ensure(same(checked, makePlan(cases, checked.conditions, checked.repeats)), 'Plan does not match the complete cases, hashes, or splits');
  return checked;
}

export function objectiveDetails(output: Output, expected: Case['expected']): Diagnostic[] {
  const details: Diagnostic[] = [];
  if (output.action !== expected.action) details.push({ field: 'action', reason: 'mismatch', expected: expected.action, actual: output.action, actual_present: true });
  for (const key of [...new Set([...Object.keys(expected.facts), ...Object.keys(output.facts)])].sort()) {
    const actual = Object.hasOwn(output.facts, key) ? output.facts[key] : undefined;
    const wanted = Object.hasOwn(expected.facts, key) ? expected.facts[key] : undefined;
    if (actual === undefined && wanted !== undefined) details.push({ field: `facts.${key}`, reason: 'missing_fact', expected: wanted });
    else if (wanted === undefined && actual !== undefined) details.push({ field: `facts.${key}`, reason: 'unexpected_fact', actual });
    else if (actual !== undefined && wanted !== undefined && !same(actual, wanted)) details.push({ field: `facts.${key}`, reason: 'mismatch', expected: wanted, actual });
  }
  return details;
}

function oracleReady(item: Case): boolean {
  return item.review_status === 'verified' && item.independent_reference && item.sources.every(source => source.authoritative);
}
export function rowSuccess(row: Row): boolean {
  return !row.missing && !row.error && !row.unreviewed && row.oracle_ready && !row.synthetic && row.objective === true && row.evidence === 'pass' && row.answer === 'pass';
}
export function rowFailure(row: Row): boolean { return row.objective === false || row.evidence === 'fail' || row.answer === 'fail'; }

export function summarize(rows: Row[]): Counts {
  const counts: Counts = { expected: rows.length, missing: 0, error: 0, unreviewed: 0, objective_pass: 0, objective_fail: 0,
    evidence_fail: 0, answer_fail: 0, reviewed_success: 0, synthetic: 0, reviewed_success_rate: null };
  for (const row of rows) {
    for (const field of ['missing', 'error', 'unreviewed', 'synthetic'] as const) counts[field] += Number(row[field]);
    counts.objective_pass += Number(row.objective === true);
    counts.objective_fail += Number(row.objective === false);
    counts.evidence_fail += Number(row.evidence === 'fail');
    counts.answer_fail += Number(row.answer === 'fail');
    counts.reviewed_success += Number(rowSuccess(row));
  }
  counts.reviewed_success_rate = rows.length ? counts.reviewed_success / rows.length : null;
  return counts;
}

function gates(rows: Row[], conditions: Condition[]): Record<string, Gate> {
  const result: Record<string, Gate> = {};
  const synthetic = rows.some(row => row.synthetic);
  for (const condition of conditions) {
    const selected = rows.filter(row => row.condition === condition);
    const holdout = selected.filter(row => row.split === 'holdout');
    const counts = summarize(holdout);
    const reasons: string[] = [];
    if (!holdout.length) reasons.push('no_holdout_cases');
    if (synthetic) reasons.push('synthetic_present_in_batch');
    for (const field of ['missing', 'error', 'unreviewed', 'synthetic'] as const) if (counts[field]) reasons.push(field);
    if (holdout.some(row => !row.oracle_ready)) reasons.push('unverified_or_nonindependent_or_non_authoritative_oracle');
    if (new Set(selected.filter(row => row.versions !== null).map(row => digest(row.versions))).size > 1) reasons.push('mixed_versions_within_condition');
    const failed = holdout.some(row => rowFailure(row) && row.oracle_ready && !row.synthetic);
    if (failed) reasons.push('confirmed_failure');
    else if (holdout.some(rowFailure)) reasons.push('unconfirmed_failure_against_draft_or_synthetic_oracle');
    result[condition] = { gate: synthetic ? 'INCONCLUSIVE' : failed ? 'FAIL' : reasons.length ? 'INCONCLUSIVE' : 'PASS', reasons, holdout_counts: counts };
  }
  return result;
}

function metrics(rows: Row[], conditions: Condition[]): Report['metrics'] {
  const result: Report['metrics'] = {};
  for (const condition of conditions) {
    const selected = rows.filter(row => row.condition === condition);
    const summarizeMetric = (key: typeof METRIC_KEYS[number]): { sum: number; measured_runs: number; expected_runs: number } => {
      const values = selected.flatMap(row => row.metrics[key] === null ? [] : [row.metrics[key]]);
      const sum = values.reduce((total, value) => total + value, 0);
      ensure(Number.isFinite(sum), `Nonfinite metric total: ${key}`);
      return { sum, measured_runs: values.length, expected_runs: selected.length };
    };
    result[condition] = { elapsed_ms: summarizeMetric('elapsed_ms'), input_tokens: summarizeMetric('input_tokens'), output_tokens: summarizeMetric('output_tokens') };
  }
  return result;
}

function label(rows: Row[]): string {
  return rows.some(row => row.synthetic) ? 'SYNTHETIC PRESENT — NOT ACTUAL MODEL PERFORMANCE' : 'Imported actual-run declarations; provenance not independently authenticated';
}
const slot = (id: string, condition: Condition, repeat: number): string => JSON.stringify([id, condition, repeat]);

export function evaluate(cases: Case[], runs: Run[], reviews: Review[] = [], suppliedPlan?: EvaluationPlan): Report {
  const checkedCases = parseCases(cases);
  const checkedRuns = parseRuns(runs);
  const checkedReviews = parseReviews(reviews);
  const plan = suppliedPlan === undefined ? makePlan(checkedCases) : validatePlan(suppliedPlan, checkedCases);
  const byCase = new Map(checkedCases.map(item => [item.id, item]));
  const byRun = new Map<string, Run>();
  const slots = new Map<string, Run>();
  for (const run of checkedRuns) {
    const item = byCase.get(run.case_id);
    ensure(item, `Unknown run case: ${run.case_id}`);
    ensure(!byRun.has(run.run_id), `Duplicate run id: ${run.run_id}`);
    const key = slot(run.case_id, run.condition, run.repeat);
    ensure(!slots.has(key), `Duplicate run slot: ${key}`);
    ensure(plan.conditions.includes(run.condition) && run.repeat <= plan.repeats, `Run is outside planned slots: ${run.run_id}`);
    ensure(run.case_sha256 === digest(item), `Case hash mismatch: ${run.run_id}`);
    ensure(run.versions.dataset === plan.dataset_sha256, `Dataset hash mismatch: ${run.run_id}`);
    if (run.status === 'ok') ensure(run.output_sha256 === digest(run.output), `Output hash mismatch: ${run.run_id}`);
    slots.set(key, run); byRun.set(run.run_id, run);
  }
  const byReview = new Map<string, Review>();
  for (const review of checkedReviews) {
    const run = byRun.get(review.run_id);
    ensure(run?.status === 'ok', 'Review must reference a known successful run');
    ensure(!byReview.has(review.run_id), `Duplicate review: ${review.run_id}`);
    ensure(review.case_sha256 === run.case_sha256 && review.output_sha256 === run.output_sha256, `Stale review: ${review.run_id}`);
    const item = byCase.get(run.case_id);
    ensure(item, `Unknown review case: ${run.case_id}`);
    summarizeReview(item.rubric, review);
    byReview.set(review.run_id, review);
  }
  const rows: Row[] = [];
  for (const item of sortedCases(checkedCases)) for (const condition of plan.conditions) for (let repeat = 1; repeat <= plan.repeats; repeat++) {
    const run = slots.get(slot(item.id, condition, repeat));
    const completed = run?.status === 'ok' ? run : undefined;
    const review = completed ? byReview.get(completed.run_id) : undefined;
    const reviewed = review ? summarizeReview(item.rubric, review) : undefined;
    const details = completed ? objectiveDetails(completed.output, item.expected) : [];
    rows.push({ case_id: item.id, case_sha256: digest(item), split: item.split, condition, repeat,
      rubric: item.rubric, rubric_sha256: digest(item.rubric),
      run_id: run?.run_id ?? null, missing: run === undefined, error: run?.status === 'error',
      unreviewed: completed !== undefined && (!reviewed || reviewed.pending),
      synthetic: item.origin === 'synthetic' || run?.execution === 'synthetic', oracle_ready: oracleReady(item),
      versions: run?.versions ?? null, objective: completed ? details.length === 0 : null, objective_details: details,
      answer: reviewed?.answer ?? 'pending', evidence: reviewed?.evidence ?? 'pending',
      output_sha256: completed?.output_sha256 ?? null, review: review ?? null,
      metrics: { elapsed_ms: run?.elapsed_ms ?? null, input_tokens: run?.input_tokens ?? null, output_tokens: run?.output_tokens ?? null },
    });
  }
  return structuredClone({ harness: HARNESS_VERSION, dataset_sha256: plan.dataset_sha256, policy: POLICY,
    plan, plan_sha256: digest(plan), label: label(rows), gate_scope: 'holdout only, per condition; not evidence of comparative improvement',
    overall_counts: summarize(rows), condition_counts: Object.fromEntries(plan.conditions.map(condition => [condition, summarize(rows.filter(row => row.condition === condition))])),
    gates: gates(rows, plan.conditions), metrics: metrics(rows, plan.conditions), rows,
  });
}

/** Detect inconsistent or stale reports. Consistently fabricated provenance still needs review. */
export function validateReport(value: unknown): Report {
  const report = reportSchema.parse(value);
  const plan = parsePlan(report.plan);
  ensure(report.plan_sha256 === digest(plan) && report.dataset_sha256 === plan.dataset_sha256, 'Report plan hash or dataset mismatch');
  const cases = new Map(plan.cases.map(item => [item.case_id, item]));
  const planned = new Set(plan.cases.flatMap(item => plan.conditions.flatMap(condition => Array.from({ length: plan.repeats }, (_, i) => slot(item.case_id, condition, i + 1)))));
  ensure(report.rows.length === planned.size, 'Report rows do not cover complete planned slots');
  const seen = new Set<string>();
  const runIds = new Set<string>();
  const readiness = new Map<string, boolean>();
  for (const row of report.rows) {
    const item = cases.get(row.case_id);
    ensure(item && row.case_sha256 === item.case_sha256 && row.split === item.split, 'Report case hash or split differs from plan');
    ensure(row.rubric_sha256 === item.rubric_sha256 && digest(row.rubric) === item.rubric_sha256, 'Report rubric differs from plan');
    const key = slot(row.case_id, row.condition, row.repeat);
    ensure(planned.has(key) && !seen.has(key), 'Report has an unknown or duplicate planned slot'); seen.add(key);
    const priorReady = readiness.get(row.case_id);
    ensure(priorReady === undefined || priorReady === row.oracle_ready, 'Inconsistent oracle readiness'); readiness.set(row.case_id, row.oracle_ready);
    if (row.missing) {
      ensure(row.run_id === null && row.versions === null && !row.error && METRIC_KEYS.every(metric => row.metrics[metric] === null), 'Missing run cannot contain execution evidence');
    } else {
      ensure(row.run_id !== null && !runIds.has(row.run_id) && row.versions !== null, 'Report run provenance is incomplete or duplicated');
      runIds.add(row.run_id);
      ensure(row.versions.dataset === report.dataset_sha256, 'Report version dataset mismatch');
    }
    if (row.missing || row.error) {
      ensure(row.objective === null && row.objective_details.length === 0 && !row.unreviewed && row.answer === 'pending' && row.evidence === 'pending' && row.review === null && row.output_sha256 === null, 'Missing/error run cannot carry completed judgments');
    } else {
      ensure(typeof row.objective === 'boolean' && row.objective === (row.objective_details.length === 0) && row.output_sha256 !== null, 'Objective verdict disagrees with diagnostics');
      if (row.review === null) ensure(row.answer === 'pending' && row.evidence === 'pending' && row.unreviewed, 'Verdict without human review');
      else {
        ensure(row.review.run_id === row.run_id && row.review.case_sha256 === row.case_sha256 && row.review.output_sha256 === row.output_sha256, 'Report has a stale review binding');
        const reviewed = summarizeReview(row.rubric, row.review);
        ensure(row.answer === reviewed.answer && row.evidence === reviewed.evidence, 'Report verdict differs from human review');
        ensure(row.unreviewed === reviewed.pending, 'Review completeness is inconsistent');
      }
    }
  }
  ensure(same(report.overall_counts, summarize(report.rows)), 'Report counts disagree with rows');
  ensure(same(report.condition_counts, Object.fromEntries(plan.conditions.map(condition => [condition, summarize(report.rows.filter(row => row.condition === condition))]))), 'Report condition counts disagree with rows');
  ensure(same(report.gates, gates(report.rows, plan.conditions)), 'Report gates disagree with rows');
  ensure(same(report.metrics, metrics(report.rows, plan.conditions)), 'Report metrics disagree with rows');
  ensure(report.label === label(report.rows), 'Report label disagrees with data origin');
  return report;
}
