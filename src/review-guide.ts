import { mkdir, open, unlink, type FileHandle } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { evaluate, ensure } from './evaluate.js';
import { digest } from './json.js';
import { parseCases, parseRuns, type Case, type Run, type Review, type EvaluationPlan } from './schema.js';
import { jsonBlock as block } from './reporting.js';

/** Contains answer keys: write this beside reviewer files, never into model context. */
export async function writeReviewBundle(casesInput: Case[], runsInput: Run[], plan: EvaluationPlan, out: string): Promise<{ templates: number; path: string; guide: string; status: string }> {
  ensure(out.endsWith('.jsonl'), 'Review output must use a .jsonl extension');
  const cases = parseCases(casesInput), runs = parseRuns(runsInput);
  evaluate(cases, runs, [], plan);
  const byCase = new Map(cases.map(item => [item.id, item]));
  const templates: Review[] = [];
  const sections = [
    '# 답변 검토 가이드',
    '이 문서는 평가자용 정답과 판정 기준을 포함합니다. 모델 입력 자료에 넣지 않습니다.',
    '사례와 원문을 확인한 뒤 JSONL의 검토자·검토 시점, 각 기준의 verdict와 rationale을 작성합니다. pass/fail에는 판단 이유와 원문 위치를 남깁니다. 아직 판단하지 못한 기준은 pending으로 둡니다.',
    '심각도는 실행 전에 확정한 rubric을 따릅니다. blocker·major 실패는 필수 실패, minor 실패는 개선 권고입니다. minor도 검토하지 않았다면 pending으로 남기며 통과 처리하지 않습니다.',
    `계획한 실행 ${plan.cases.length * plan.conditions.length * plan.repeats}건 · 전달된 실행 ${runs.length}건 · 오류 ${runs.filter(run => run.status === 'error').length}건`,
  ];
  for (const run of runs) {
    if (run.status === 'error') continue;
    const item = byCase.get(run.case_id);
    ensure(item, `Unknown review case: ${run.case_id}`);
    const rubricHash = digest(item.rubric);
    templates.push({
      run_id: run.run_id, case_sha256: run.case_sha256, output_sha256: run.output_sha256, rubric_sha256: rubricHash,
      reviewer_kind: 'human', reviewer_id: '', reviewed_at: '',
      criterion_results: item.rubric.criteria.map(criterion => ({ criterion_id: criterion.id, verdict: 'pending', rationale: '' })),
    });
    sections.push(
      `## 검토 ${templates.length}`,
      block({ run_id: run.run_id, case_id: item.id, condition: run.condition, repeat: run.repeat, case_sha256: run.case_sha256, output_sha256: run.output_sha256, rubric_sha256: rubricHash }),
      '### 질문과 입력', block({ question: item.question, inputs: item.inputs ?? {} }),
      '### 정답과 근거', block({ expected: item.expected, sources: item.sources }),
      '### 모델의 원답변', block(run.output),
      '### 판정 기준', block(item.rubric),
    );
  }
  const jsonPath = resolve(out), guidePath = resolve(out.slice(0, -6) + '.md');
  await mkdir(dirname(jsonPath), { recursive: true });
  const created: string[] = [];
  const handles: FileHandle[] = [];
  try {
    // Reserve both paths before writing. A pre-existing companion must survive.
    const jsonFile = await open(jsonPath, 'wx'); handles.push(jsonFile); created.push(jsonPath);
    const guideFile = await open(guidePath, 'wx'); handles.push(guideFile); created.push(guidePath);
    await jsonFile.writeFile(templates.map(item => JSON.stringify(item)).join('\n') + (templates.length ? '\n' : ''), 'utf8');
    await guideFile.writeFile(sections.join('\n\n') + '\n', 'utf8');
    for (const handle of handles) await handle.close();
  } catch (error: unknown) {
    await Promise.allSettled(handles.map(handle => handle.close()));
    await Promise.allSettled(created.map(path => unlink(path)));
    throw error;
  }
  return { templates: templates.length, path: jsonPath, guide: guidePath, status: 'requires human review' };
}
