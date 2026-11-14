// This module also runs in the trusted comment job: no project dependencies,
// report text, paths, case IDs, model output or review explanations are accepted.
const SCHEMA = 'graduation-wiki-eval/public-summary-v1';
const countKeys = ['expected', 'missing', 'errors', 'objectivePassed', 'objectiveFailed', 'reviewPending', 'reviewedSuccess', 'requiredFail', 'advisoryRuns'];
const conditions = ['A', 'B', 'C'];

function object(value, keys) {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      Object.keys(value).length !== keys.length || keys.some(key => !Object.hasOwn(value, key))) {
    throw new Error('Invalid public summary shape');
  }
}

export function parsePublicSummary(value) {
  object(value, ['schema', 'mode', 'execution', 'conditions']);
  if (value.schema !== SCHEMA || !['sample', 'claude'].includes(value.mode) ||
      !['completed', 'failed'].includes(value.execution) || !Array.isArray(value.conditions) ||
      value.conditions.length > 3 || (value.execution === 'completed' && value.conditions.length === 0)) {
    throw new Error('Invalid public summary header');
  }
  const seen = new Set();
  for (const row of value.conditions) {
    object(row, ['condition', ...countKeys, 'criterionFailures', 'gate']);
    if (!conditions.includes(row.condition) || seen.has(row.condition) || !['PASS', 'FAIL', 'INCONCLUSIVE'].includes(row.gate)) {
      throw new Error('Invalid public summary condition');
    }
    seen.add(row.condition);
    for (const key of countKeys) {
      if (!Number.isSafeInteger(row[key]) || row[key] < 0 || row[key] > 1_000_000) throw new Error('Invalid public summary count');
    }
    object(row.criterionFailures, ['blocker', 'major', 'minor']);
    for (const count of Object.values(row.criterionFailures)) {
      if (!Number.isSafeInteger(count) || count < 0 || count > 1_000_000) throw new Error('Invalid criterion failure count');
    }
    const completed = row.expected - row.missing - row.errors;
    if (row.expected === 0 || completed < 0 || row.objectivePassed + row.objectiveFailed !== completed ||
        row.reviewPending > completed || row.reviewedSuccess > row.objectivePassed ||
        row.requiredFail > completed || row.advisoryRuns > completed ||
        row.reviewedSuccess + row.reviewPending > completed ||
        (value.execution === 'completed' && (row.missing > 0 || row.errors > 0)) ||
        (value.mode === 'sample' && (row.gate !== 'INCONCLUSIVE' || row.reviewedSuccess !== 0))) {
      throw new Error('Inconsistent public summary counts');
    }
  }
  return structuredClone(value);
}

export async function createPublicSummary(report, mode, execution = 'completed') {
  const { validateReport } = await import('../dist/evaluate.js');
  const checked = validateReport(report);
  return parsePublicSummary({ schema: SCHEMA, mode, execution,
    conditions: checked.plan.conditions.map(condition => {
      const counts = checked.condition_counts[condition];
      return { condition, expected: counts.expected, missing: counts.missing, errors: counts.error,
        objectivePassed: counts.objective_pass, objectiveFailed: counts.objective_fail,
        reviewPending: counts.unreviewed, reviewedSuccess: counts.reviewed_success,
        requiredFail: counts.required_fail, advisoryRuns: counts.advisory_runs,
        criterionFailures: { blocker: counts.criterion_failures.blocker, major: counts.criterion_failures.major, minor: counts.criterion_failures.minor },
        gate: checked.gates[condition].gate };
    }),
  });
}

export function failedPublicSummary(mode) {
  return parsePublicSummary({ schema: SCHEMA, mode, execution: 'failed', conditions: [] });
}

export function renderPublicSummary(value) {
  const summary = parsePublicSummary(value);
  const lines = [summary.mode === 'sample' ? '### 공개 예제 평가' : '### 수동 모델 평가', '',
    summary.mode === 'sample'
      ? '합성 사례와 고정 응답을 사용하는 평가입니다. 실제 모델이나 ALLCLL WIKI의 성능 결과가 아닙니다.'
      : '모델 평가의 실행 상태와 집계입니다. 답변·근거의 사람 검토가 끝나기 전에는 품질을 승인하지 않습니다.', '',
    summary.execution === 'completed' ? '실행: 완료' : '실행: 실패 또는 누락 있음', '',
    '| 조건 | 계획 | 자동 검사 통과 | 자동 검사 실패 | 실행 오류 | 누락 | 검토 대기 | 품질 판정 |',
    '| --- | ---: | ---: | ---: | ---: | ---: | ---: | --- |'];
  for (const row of [...summary.conditions].sort((a, b) => a.condition.localeCompare(b.condition))) {
    lines.push(`| ${row.condition} | ${row.expected} | ${row.objectivePassed} | ${row.objectiveFailed} | ${row.errors} | ${row.missing} | ${row.reviewPending} | ${row.gate} |`);
  }
  lines.push('', '| 조건 | 필수 조건 실패 실행 | 권고 사항이 있는 실행 | BLOCKER 항목 | MAJOR 항목 | MINOR 항목 |',
    '| --- | ---: | ---: | ---: | ---: | ---: |');
  for (const row of [...summary.conditions].sort((a, b) => a.condition.localeCompare(b.condition))) {
    lines.push(`| ${row.condition} | ${row.requiredFail} | ${row.advisoryRuns} | ${row.criterionFailures.blocker} | ${row.criterionFailures.major} | ${row.criterionFailures.minor} |`);
  }
  lines.push('', '워크플로 성공은 실행 절차의 성공을 뜻합니다. WIKI·Skill 품질이나 배포 승인을 의미하지 않습니다.',
    '표의 실행 건수는 dev와 holdout의 합계이며, 품질 판정은 holdout에만 적용됩니다.',
    '질문·답변·사례 ID·근거·검토 내용은 이 요약에 포함하지 않습니다.', '');
  return lines.join('\n');
}
