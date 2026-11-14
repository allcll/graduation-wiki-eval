import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { digest, parseJson, readRecords, writeRecords } from '../src/json.js';
import { HARNESS_VERSION, VERSION_KEYS, parseCases, parseRuns, parseReviews, versionsSchema, type Case, type Run, type Review } from '../src/schema.js';
import { datasetHash, evaluate, makePlan, objectiveDetails, validatePlan, validateReport } from '../src/evaluate.js';
import { compareReports } from '../src/compare.js';

function at<T>(values: T[], index = 0): T {
  const item = values[index];
  if (item === undefined) throw new Error('Missing test fixture');
  return item;
}
function success(runs: Run[], index = 0): Extract<Run, { status: 'ok' }> {
  const run = at(runs, index);
  if (run.status !== 'ok') throw new Error('Expected successful test fixture');
  return run;
}
function fixtures(): { cases: Case[]; runs: Run[]; reviews: Review[] } {
  // These declarations exercise real-data branches; they are not empirical evidence.
  const cases = parseCases([0, 1, 2].map(index => ({
    id: `test-${index}`, family: `family-${index}`, split: 'holdout', origin: 'real',
    review_status: 'verified', independent_reference: true, oracle_reviewer: 'unit-test-only',
    question: 'Fictional question for software testing', expected: { action: 'answer', facts: { credits: index + 1 } },
    sources: [{ id: 'test-source', version: 'test-v1', locator: 'test clause', excerpt: 'Invented source', authoritative: true }],
  })));
  const versions = versionsSchema.parse({ ...Object.fromEntries(VERSION_KEYS.map(key => [key, 'test-v1'])), dataset: datasetHash(cases), harness: HARNESS_VERSION });
  const runs: Run[] = cases.map(item => {
    const output = { ...structuredClone(item.expected), answer_text: 'Test answer only', citations: [] };
    return { run_id: `${item.id}-C-1`, case_id: item.id, condition: 'C', repeat: 1, execution: 'real', status: 'ok',
      case_sha256: digest(item), versions: { ...versions }, started_at: 'test-only', output, output_sha256: digest(output) };
  });
  const reviews = runs.map((_, index): Review => {
    const run = success(runs, index);
    return { run_id: run.run_id, case_sha256: run.case_sha256, output_sha256: run.output_sha256,
      reviewer_kind: 'human', reviewer_id: 'test-human-attestation', reviewed_at: 'test-only', rationale: 'Manufactured review',
      answer_verdict: 'pass', evidence_verdict: 'pass' };
  });
  return { cases, runs, reviews };
}
function refresh(fixture: ReturnType<typeof fixtures>): void {
  fixture.runs.forEach((run, index) => {
    run.case_sha256 = digest(at(fixture.cases, index));
    run.versions.dataset = datasetHash(fixture.cases);
    const review = fixture.reviews.find(item => item.run_id === run.run_id);
    if (review) review.case_sha256 = run.case_sha256;
    if (run.status === 'ok') {
      run.output_sha256 = digest(run.output);
      if (review) review.output_sha256 = run.output_sha256;
    }
  });
}
function report(fixture: ReturnType<typeof fixtures>) {
  return evaluate(fixture.cases, fixture.runs, fixture.reviews, makePlan(fixture.cases, ['C']));
}

test('verified complete holdout can pass with a fixed plan', () => {
  const result = report(fixtures());
  assert.equal(result.gates['C']?.gate, 'PASS');
  assert.equal(result.overall_counts.reviewed_success_rate, 1);
  assert.deepEqual(validateReport(result), result);
});

test('saved plan preserves missing conditions and repetitions', () => {
  const fixture = fixtures();
  const plan = makePlan(fixture.cases, ['A', 'B', 'C'], 3);
  const result = evaluate(fixture.cases, fixture.runs, fixture.reviews, plan);
  assert.equal(result.overall_counts.expected, 27);
  assert.equal(result.overall_counts.missing, 24);
  assert.equal(result.gates['C']?.gate, 'INCONCLUSIVE');
  assert.throws(() => validatePlan(plan, fixture.cases.slice(1)), /complete cases/);
  at(fixture.cases).split = 'dev';
  assert.throws(() => validatePlan(plan, fixture.cases), /complete cases/);
});

test('missing and error responses remain in denominator with incurred cost', () => {
  const fixture = fixtures();
  const old = at(fixture.runs);
  fixture.runs = [{ run_id: old.run_id, case_id: old.case_id, condition: old.condition, repeat: old.repeat,
    execution: old.execution, started_at: old.started_at, case_sha256: old.case_sha256, versions: old.versions,
    status: 'error', error: 'timeout', elapsed_ms: 120, input_tokens: 10 }, at(fixture.runs, 1)];
  fixture.reviews = [at(fixture.reviews, 1)];
  const result = report(fixture);
  assert.equal(result.overall_counts.expected, 3);
  assert.equal(result.overall_counts.missing, 1);
  assert.equal(result.overall_counts.error, 1);
  assert.equal(result.overall_counts.reviewed_success_rate, 1 / 3);
  assert.equal(result.metrics['C']?.elapsed_ms.sum, 120);
  assert.equal(result.gates['C']?.gate, 'INCONCLUSIVE');
});

test('both human verdicts are required and model confidence is ignored', () => {
  const fixture = fixtures();
  success(fixture.runs).output['evidence_pass'] = true; refresh(fixture);
  fixture.reviews = [];
  assert.equal(report(fixture).overall_counts.reviewed_success, 0);
  assert.equal(report(fixture).gates['C']?.gate, 'INCONCLUSIVE');
  const other = fixtures(); at(other.reviews).answer_verdict = 'pending';
  assert.equal(report(other).gates['C']?.gate, 'INCONCLUSIVE');
  at(other.reviews).answer_verdict = 'fail';
  assert.equal(report(other).gates['C']?.gate, 'FAIL');
});

test('confirmed failures stay visible even with pending reviews', () => {
  const fixture = fixtures();
  success(fixture.runs).output.facts['credits'] = 999; refresh(fixture);
  fixture.reviews = [];
  assert.equal(report(fixture).gates['C']?.gate, 'FAIL');
});

test('synthetic and draft oracle mismatches are not verified quality failures', () => {
  for (const variant of ['synthetic-run', 'synthetic-case', 'draft', 'non-independent', 'non-authoritative'] as const) {
    const fixture = fixtures();
    success(fixture.runs).output.facts['credits'] = 999;
    if (variant === 'synthetic-run') at(fixture.runs).execution = 'synthetic';
    if (variant === 'synthetic-case') at(fixture.cases).origin = 'synthetic';
    if (variant === 'draft') at(fixture.cases).review_status = 'draft';
    if (variant === 'non-independent') at(fixture.cases).independent_reference = false;
    if (variant === 'non-authoritative') at(at(fixture.cases).sources).authoritative = false;
    refresh(fixture);
    assert.equal(report(fixture).gates['C']?.gate, 'INCONCLUSIVE', variant);
    assert.equal(report(fixture).overall_counts.reviewed_success, 2, variant);
  }
});

test('family leakage and duplicate case IDs are rejected', () => {
  const fixture = fixtures();
  at(fixture.cases, 1).family = at(fixture.cases).family;
  at(fixture.cases, 1).split = 'dev';
  assert.throws(() => parseCases(fixture.cases), /Family leakage/);
  assert.throws(() => parseCases([at(fixture.cases), at(fixture.cases)]), /Duplicate case/);
});

test('stale case, output, dataset and review bindings are rejected', () => {
  const patches: ((fixture: ReturnType<typeof fixtures>) => void)[] = [
    fixture => { at(fixture.runs).case_sha256 = digest('stale'); },
    fixture => { success(fixture.runs).output_sha256 = digest('stale'); },
    fixture => { at(fixture.runs).versions.dataset = digest('stale'); },
    fixture => { at(fixture.reviews).case_sha256 = digest('stale'); },
    fixture => { at(fixture.reviews).output_sha256 = digest('stale'); },
  ];
  for (const patch of patches) { const fixture = fixtures(); patch(fixture); assert.throws(() => report(fixture)); }
});

test('whitespace in full answer is preserved and bound to the human review', () => {
  const fixture = fixtures();
  success(fixture.runs).output.answer_text = '  Answer with whitespace\n'; refresh(fixture);
  assert.equal(success(parseRuns(fixture.runs)).output.answer_text, '  Answer with whitespace\n');
  assert.equal(report(fixture).gates['C']?.gate, 'PASS');
  success(fixture.runs).output.answer_text = 'Answer with whitespace';
  assert.throws(() => report(fixture), /Output hash mismatch/);
});

test('duplicate run slots and duplicate, orphan or model reviews are rejected', () => {
  const fixture = fixtures();
  fixture.runs.push({ ...at(fixture.runs), run_id: 'other-id' });
  assert.throws(() => report(fixture), /Duplicate run slot/);
  const other = fixtures(); other.reviews.push(at(other.reviews));
  assert.throws(() => report(other), /Duplicate review/);
  at(other.reviews).run_id = 'missing';
  assert.throws(() => report(other), /known successful/);
  assert.throws(() => parseReviews([{ ...at(fixtures().reviews), reviewer_kind: 'model' }]));
});

test('strict run union rejects output on errors and missing output on success', () => {
  const fixture = fixtures();
  assert.throws(() => parseRuns([{ ...at(fixture.runs), status: 'error', error: 'timeout' }]));
  assert.throws(() => parseRuns([{ run_id: 'missing-fields', status: 'ok' }]));
  assert.throws(() => parseRuns([{ ...at(fixture.runs), versions: { ...at(fixture.runs).versions, harness: 'allcll-offline-v1' } }]));
});

test('diagnostics distinguish missing, extra and wrong typed facts', () => {
  const details = objectiveDetails({ action: 'answer', facts: { x: true, extra: 1 }, answer_text: 'test' },
    { action: 'clarify', facts: { x: 1, absent: 'needed' } });
  assert.deepEqual(details.map(item => [item.field, item.reason]), [
    ['action', 'mismatch'], ['facts.absent', 'missing_fact'], ['facts.extra', 'unexpected_fact'], ['facts.x', 'mismatch'],
  ]);
});

test('fact names inherited from Object.prototype are compared as own JSON fields', () => {
  assert.deepEqual(objectiveDetails({ action: 'answer', facts: { toString: 'extra' }, answer_text: 'test' },
    { action: 'answer', facts: { constructor: 'needed' } }), [
    { field: 'facts.constructor', reason: 'missing_fact', expected: 'needed' },
    { field: 'facts.toString', reason: 'unexpected_fact', actual: 'extra' },
  ]);
  assert.deepEqual(objectiveDetails({ action: 'answer', facts: { constructor: 'same' }, answer_text: 'test' },
    { action: 'answer', facts: { constructor: 'same' } }), []);
});

test('mixed versions block a pass and unmeasured costs stay unmeasured', () => {
  const fixture = fixtures(); at(fixture.runs).versions.model = 'other-model';
  const result = report(fixture);
  assert.equal(result.gates['C']?.gate, 'INCONCLUSIVE');
  assert.equal(result.metrics['C']?.input_tokens.measured_runs, 0);
  assert.equal(result.metrics['C']?.input_tokens.expected_runs, 3);
});

test('dev-only and synthetic batches cannot produce holdout approval', () => {
  const fixture = fixtures(); fixture.cases.forEach(item => { item.split = 'dev'; }); refresh(fixture);
  assert.equal(report(fixture).gates['C']?.gate, 'INCONCLUSIVE');
  const synthetic = fixtures(); synthetic.cases.forEach(item => { item.origin = 'synthetic'; }); refresh(synthetic);
  assert.match(report(synthetic).label, /NOT ACTUAL MODEL PERFORMANCE/);
});

test('reported rows do not change when caller data is mutated later', () => {
  const fixture = fixtures(), result = report(fixture), original = digest(result);
  at(fixture.reviews).answer_verdict = 'fail';
  at(fixture.runs).versions.model = 'changed';
  assert.equal(digest(result), original);
});

test('same total success can contain both an improvement and a regression', () => {
  const fixture = fixtures(); at(fixture.reviews).answer_verdict = 'fail';
  const baseline = report(fixture);
  at(fixture.reviews).answer_verdict = 'pass'; at(fixture.reviews, 1).answer_verdict = 'fail';
  fixture.runs.forEach(run => { run.versions.wiki = 'wiki-v2'; });
  const result = compareReports(baseline, report(fixture));
  assert.equal(result.status, 'COMPARABLE');
  assert.equal(result.counts.improved, 1); assert.equal(result.counts.regressed, 1);
});

test('non-intervention metadata changes make version comparison inconclusive', () => {
  for (const key of [...VERSION_KEYS.filter(key => !['wiki', 'skill', 'harness', 'dataset'].includes(key)), 'adapter']) {
    const fixture = fixtures(), baseline = report(fixture);
    fixture.runs.forEach(run => { run.versions[key] = 'changed'; });
    assert.equal(compareReports(baseline, report(fixture)).status, 'INCONCLUSIVE', key);
  }
});

test('missing or unreviewed pairs are not compared as failures', () => {
  const fixture = fixtures(), baseline = report(fixture);
  fixture.runs.pop(); fixture.reviews.pop();
  const result = compareReports(baseline, report(fixture));
  assert.equal(result.planned_pairs, 3); assert.equal(result.comparable_pairs, 2);
  assert.equal(result.status, 'INCONCLUSIVE');
  const pending = fixtures(); pending.reviews = [];
  assert.equal(compareReports(baseline, report(pending)).comparable_pairs, 0);
});

test('tampered summaries, dropped rows and detached reviews are rejected', () => {
  const baseline = report(fixtures());
  const edits: ((report: ReturnType<typeof evaluate>) => void)[] = [
    report => { report.rows.pop(); },
    report => { report.overall_counts.reviewed_success = 0; },
    report => { at(report.rows).review = null; },
    report => { at(report.rows).output_sha256 = digest('changed'); },
    report => { report.label = 'A fabricated measured result'; },
  ];
  for (const edit of edits) { const result = structuredClone(baseline); edit(result); assert.throws(() => validateReport(result)); }
});

test('changed plans and synthetic reports remain incomparable', () => {
  const fixture = fixtures(), baseline = report(fixture);
  const repeated = evaluate(fixture.cases, fixture.runs, fixture.reviews, makePlan(fixture.cases, ['C'], 2));
  assert.equal(compareReports(baseline, repeated).status, 'INCONCLUSIVE');
  fixture.cases.forEach(item => { item.origin = 'synthetic'; }); refresh(fixture);
  assert.equal(compareReports(report(fixture), report(fixture)).status, 'INCONCLUSIVE');
});

test('strict JSON rejects duplicate keys, nonfinite values and non-JSON whitespace', () => {
  for (const text of ['{"x":1,"x":2}', '{"nested":{"x":1,"x":2}}', '{"__proto__":{}}', '1e999', 'NaN', 'Infinity', '[1,]', '{"x":1,}', '\u00a0{}', 'true false']) assert.throws(() => parseJson(text), text);
  assert.equal(digest(parseJson('{"b":2,"a":1}')), digest({ a: 1, b: 2 }));
  assert.equal(parseJson('"\\\"nested\\\""'), '"nested"');
  assert.notEqual(digest(true), digest(1));
  for (const value of [undefined, NaN, new Date(), { x: undefined }, { x: Symbol('x') }]) assert.throws(() => digest(value));
});

test('JSONL roundtrip preserves exact answers and Unicode', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'grad-eval-json-'));
  try {
    const path = join(dir, 'records.jsonl'); const data = [{ answer: '  학번을 알려주세요.\n' }, { number: 2 }];
    await writeRecords(path, data);
    assert.equal(digest(await readRecords(path)), digest(data));
  } finally { await rm(dir, { recursive: true, force: true }); }
});
