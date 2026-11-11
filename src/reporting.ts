import { writeFile } from 'node:fs/promises';
import type { Comparison, Report } from './schema.js';
import { writeJson } from './io.js';

export interface ErrorReport { gate: 'INCONCLUSIVE'; input_error: string }
export type SavedReport = Report | Comparison | ErrorReport;

export function markdown(report: SavedReport): string {
  if ('input_error' in report) return `# 평가 미완료\n\n**INCONCLUSIVE**\n\n${report.input_error}\n`;
  if (!('gates' in report)) return '# 버전 비교\n\n```json\n' + JSON.stringify(report, null, 2) + '\n```\n';
  const lines = ['# 평가 결과', '', `**${report.label}**`, '',
    '품질 판정은 조건별 holdout에 적용합니다. 자동 배포 승인이 아닙니다.', '',
    '| 조건 | 전체 계획 | 성공 | 누락 | 실행 오류 | 검토 대기 | holdout 판정 |',
    '| --- | ---: | ---: | ---: | ---: | ---: | --- |'];
  for (const condition of report.plan.conditions) {
    const count = report.condition_counts[condition];
    const gate = report.gates[condition];
    if (!count || !gate) throw new Error(`Missing report condition: ${condition}`);
    lines.push(`| ${condition} | ${count.expected} | ${count.reviewed_success} | ${count.missing} | ${count.error} | ${count.unreviewed} | ${gate.gate} |`);
  }
  lines.push('', '실행 건수는 dev와 holdout의 합계입니다. 판정 분모는 JSON의 holdout_counts에 기록합니다.', '', '## 판정 사유', '');
  for (const [condition, gate] of Object.entries(report.gates)) lines.push(`- ${condition}: ${gate.reasons.join(', ') || 'holdout 필수 검사 통과'}`);
  lines.push('', '## 확인할 실행', '');
  for (const row of report.rows) {
    if (row.objective === false || row.evidence === 'fail' || row.answer === 'fail') {
      lines.push(`- \`${row.case_id}\` / ${row.condition} / ${row.repeat}: ${JSON.stringify(row.objective_details)}; evidence=${row.evidence}, answer=${row.answer}`);
    }
  }
  return lines.join('\n') + '\n';
}

export async function writeReport(path: string, report: SavedReport): Promise<void> {
  if (!path.endsWith('.json')) throw new Error('Report output must use a .json extension');
  await writeJson(path, report);
  await writeFile(path.slice(0, -5) + '.md', markdown(report), 'utf8');
}
