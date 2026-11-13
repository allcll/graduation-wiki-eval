import { writeFile } from 'node:fs/promises';
import type { Comparison, Report } from './schema.js';
import { writeJson } from './io.js';

export interface ErrorReport { gate: 'INCONCLUSIVE'; input_error: string }
export type SavedReport = Report | Comparison | ErrorReport;

export function jsonBlock(value: unknown): string {
  const text = JSON.stringify(value, null, 2);
  let fenceLength = 3;
  for (const match of text.matchAll(/`+/g)) fenceLength = Math.max(fenceLength, match[0].length + 1);
  const fence = '`'.repeat(fenceLength);
  return `${fence}json\n${text}\n${fence}`;
}

export function markdown(report: SavedReport): string {
  if ('input_error' in report) return `# 평가 미완료\n\n**INCONCLUSIVE**\n\n${jsonBlock(report.input_error)}\n`;
  if (!('gates' in report)) return '# 버전 비교\n\n' + jsonBlock(report) + '\n';
  const lines = ['# 평가 결과', '', `**${report.label}**`, '',
    '품질 판정은 조건별 holdout에 적용합니다. 자동 값 검사와 blocker·major는 필수, minor 실패는 개선 권고입니다. minor를 포함해 미검토 항목이 남으면 통과하지 않습니다. 자동 배포 승인이 아닙니다.', '',
    '| 조건 | 전체 계획 | 필수 기준 통과 | 누락 | 실행 오류 | 검토 대기 | holdout 판정 |',
    '| --- | ---: | ---: | ---: | ---: | ---: | --- |'];
  for (const condition of report.plan.conditions) {
    const count = report.condition_counts[condition];
    const gate = report.gates[condition];
    if (!count || !gate) throw new Error(`Missing report condition: ${condition}`);
    lines.push(`| ${condition} | ${count.expected} | ${count.reviewed_success} | ${count.missing} | ${count.error} | ${count.unreviewed} | ${gate.gate} |`);
  }
  lines.push('', '실행 건수는 dev와 holdout의 합계입니다. 필수 기준 통과에는 minor 권고만 남은 실행도 포함합니다. 판정 분모는 JSON의 holdout_counts에 기록합니다.', '',
    '## 실패와 개선 권고', '',
    '| 조건 | 필수 실패 실행 | minor 포함 실행 | blocker 항목 | major 항목 | minor 항목 |',
    '| --- | ---: | ---: | ---: | ---: | ---: |');
  for (const condition of report.plan.conditions) {
    const count = report.condition_counts[condition];
    if (!count) throw new Error(`Missing report condition: ${condition}`);
    lines.push(`| ${condition} | ${count.required_fail} | ${count.advisory_runs} | ${count.criterion_failures.blocker} | ${count.criterion_failures.major} | ${count.criterion_failures.minor} |`);
  }
  lines.push('', '항목 건수는 사람 검토에서 fail로 판정한 기준 수입니다. 동일 사례를 반복하면 반복별로 셉니다. 자동 값 불일치는 필수 실패 실행에 포함하며, 심각도별 항목 수에는 넣지 않습니다. 미검토·누락·실행 오류는 위 표에서 별도로 집계합니다. 이 표는 dev와 holdout의 관찰값이며, 정답의 검증 여부와 최종 판정은 아래 사유를 함께 확인합니다.', '', '## 판정 사유', '');
  for (const [condition, gate] of Object.entries(report.gates)) lines.push(`- ${condition}: ${gate.reasons.join(', ') || 'holdout 필수 검사 통과'}`);
  lines.push('', '## 확인할 실행', '');
  for (const row of report.rows) {
    if (row.objective === false || row.evidence === 'fail' || row.answer === 'fail' || row.unreviewed) {
      const criteria = new Map(row.rubric.criteria.map(item => [item.id, item]));
      lines.push(jsonBlock({ case_id: row.case_id, condition: row.condition, repeat: row.repeat,
        objective_details: row.objective_details, evidence: row.evidence, answer: row.answer,
        criterion_results: row.review?.criterion_results.filter(item => item.verdict !== 'pass').map(item => ({
          criterion_id: item.criterion_id, description: criteria.get(item.criterion_id)?.description,
          severity: criteria.get(item.criterion_id)?.severity,
          verdict: item.verdict, rationale: item.rationale,
        })) ?? [],
      }), '');
    }
  }
  return lines.join('\n') + '\n';
}

export async function writeReport(path: string, report: SavedReport): Promise<void> {
  if (!path.endsWith('.json')) throw new Error('Report output must use a .json extension');
  await writeJson(path, report);
  await writeFile(path.slice(0, -5) + '.md', markdown(report), 'utf8');
}
