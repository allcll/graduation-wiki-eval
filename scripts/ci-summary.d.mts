export interface PublicCondition {
  condition: 'A' | 'B' | 'C';
  expected: number; missing: number; errors: number; objectivePassed: number;
  objectiveFailed: number; reviewPending: number; reviewedSuccess: number;
  requiredFail: number; advisoryRuns: number; criterionFailures: { blocker: number; major: number; minor: number };
  gate: 'PASS' | 'FAIL' | 'INCONCLUSIVE';
}
export interface PublicSummary {
  schema: 'graduation-wiki-eval/public-summary-v1';
  mode: 'sample' | 'claude'; execution: 'completed' | 'failed'; conditions: PublicCondition[];
}
export function parsePublicSummary(value: unknown): PublicSummary;
export function createPublicSummary(report: unknown, mode: PublicSummary['mode'], execution?: PublicSummary['execution']): Promise<PublicSummary>;
export function failedPublicSummary(mode: PublicSummary['mode']): PublicSummary;
export function renderPublicSummary(value: unknown): string;
