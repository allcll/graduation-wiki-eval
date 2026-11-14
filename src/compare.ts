import { digest } from './json.js';
import { rowSuccess, validateReport } from './evaluate.js';
import { conditionSchema, splitSchema, type Condition, type Split, type Comparison, type Report, type Row } from './schema.js';

export function compareReports(baselineInput: unknown, candidateInput: unknown, condition: Condition = 'C', split: Split = 'holdout'): Comparison {
  conditionSchema.parse(condition); splitSchema.parse(split);
  const baseline = validateReport(baselineInput);
  const candidate = validateReport(candidateInput);
  const reasons = new Set<string>();
  const transitions: Comparison['transitions'] = [];
  if (baseline.dataset_sha256 !== candidate.dataset_sha256) reasons.add('different_datasets_or_rubrics');
  if (baseline.plan_sha256 !== candidate.plan_sha256) reasons.add('different_evaluation_plans');
  const scoped = (report: Report): Map<string, Row> => new Map(report.rows.filter(row => row.condition === condition && row.split === split).map(row => [JSON.stringify([row.case_id, row.repeat]), row]));
  const left = scoped(baseline), right = scoped(candidate);
  const keys = [...new Set([...left.keys(), ...right.keys()])].sort();
  if (!left.size || left.size !== right.size || keys.length !== left.size) reasons.add('empty_or_unmatched_planned_slots');
  for (const key of keys) {
    const a = left.get(key), b = right.get(key);
    if (!a || !b) continue;
    if ([a, b].some(row => row.missing || row.error || row.unreviewed || row.synthetic || !row.oracle_ready)) {
      reasons.add('incomplete_synthetic_or_unverified_pairs'); continue;
    }
    const av = a.versions, bv = b.versions;
    if (!av || !bv) { reasons.add('missing_version_metadata'); continue; }
    const stable = [...new Set([...Object.keys(av), ...Object.keys(bv)])].filter(field => field !== 'wiki' && field !== 'skill');
    if (a.case_sha256 !== b.case_sha256 || stable.some(field => av[field] !== bv[field])) {
      reasons.add('confounded_pair_versions'); continue;
    }
    const was = rowSuccess(a), now = rowSuccess(b);
    transitions.push({ case_id: a.case_id, repeat: a.repeat, transition: !was && now ? 'improved' : was && !now ? 'regressed' : now ? 'unchanged_pass' : 'unchanged_fail' });
  }
  for (const report of [baseline, candidate]) {
    if (report.rows.some(row => row.synthetic)) reasons.add('synthetic_present_in_batch');
    const versions = new Set(report.rows.filter(row => row.condition === condition && row.versions !== null).map(row => digest(row.versions)));
    if (versions.size > 1) reasons.add('mixed_versions_within_report');
  }
  const counts: Comparison['counts'] = { improved: 0, regressed: 0, unchanged_pass: 0, unchanged_fail: 0 };
  for (const item of transitions) counts[item.transition]++;
  return { status: reasons.size ? 'INCONCLUSIVE' : 'COMPARABLE', condition, split,
    label: 'Matched diagnostic comparison; NOT a deployment approval or significance test',
    planned_pairs: keys.length, comparable_pairs: transitions.length, reasons: [...reasons].sort(), counts, transitions };
}
