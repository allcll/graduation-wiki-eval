# CI에서 평가 실행하기

평가 실행은 로컬과 CI에서 같은 CLI를 사용합니다. 현재 CI에서는 숫자 집계만 요약하고, 정답·모델 답변·사람 검토 파일은 별도로 보관합니다. 이 문서는 지금 사용할 수 있는 기능을 설명합니다.

최초 실제 평가는 로컬에서 진행하고, 이후 수동 CI와 WIKI 변경 PR 평가를 연결합니다. 수동 평가의 디스코드 웹훅 알림과 PR의 상세 결과 표시는 [평가 운영 흐름](evaluation-workflow.md)에 정리한 후속 작업이며 아직 동작하지 않습니다.

| 실행 경로 | 입력과 모델 | 공개되는 결과 |
| --- | --- | --- |
| 이 레포의 PR | 공개 합성 사례 + 고정 응답 어댑터 | 실행 건수, 자동 검사 결과, 검토 대기 수, 심각도별 실패 수 |
| 수동 `sample` | PR과 같은 공개 예제 | 같은 숫자 요약 |
| 로컬 `claude` | 직접 준비한 사례·원문·WIKI·Skill + Claude Code | 로컬 파일. GitHub로 전송하지 않음 |
| 비공개 레포의 수동 `claude` | 고정한 커밋의 사례와 자료 + Claude Code | 해당 비공개 레포의 요약과 검토용 artifact |

PR의 공개 예제는 실제 모델을 호출하지 않습니다. 합성 자료이므로 품질 판정은 `INCONCLUSIVE`입니다. 워크플로 성공은 명령 실행이 끝났다는 뜻이며, WIKI나 Skill의 품질 승인이 아닙니다. 현재 실제 ALLCLL 정답셋과 모델을 사용한 Actions 평가는 검증하지 않았습니다.

## 로컬에서 CI와 같은 흐름 실행하기

```bash
npm ci
npm run build
node scripts/evaluate-ci.mjs --mode sample --out artifacts/ci-sample-001
```

명령은 기존 CLI의 `prepare → run → review-template → report`를 순서대로 호출합니다. 출력 디렉터리는 매번 새 경로를 지정합니다.

```text
artifacts/ci-sample-001/
├── public/
│   ├── public-summary.json   숫자와 정해진 상태값만 포함
│   └── public-summary.md
└── raw/
    ├── cases.jsonl          평가자용 정답 포함
    ├── runner-config.json
    ├── experiment/          조건별 자료, 답변, 오류, 실행 기록
    ├── reviews.jsonl        사람이 채우는 검토 양식
    ├── reviews.md           질문·정답·원답변·판정 기준
    └── report.json / report.md
```

각 명령의 stdout/stderr도 `raw/`에 저장합니다. 오류 메시지에 문의나 답변이 포함될 수 있으므로 CI 로그에는 그대로 출력하지 않습니다. 공개 요약을 만들 때는 `validateReport`로 보고서를 검증하고, 허용한 숫자와 상태값만 새 객체로 옮깁니다. 질문·답변·사례 ID·근거·리뷰 설명은 요약에 포함하지 않습니다.

표의 수치는 dev와 holdout의 합계이고, 품질 판정은 holdout에만 적용됩니다. 필수 조건 실패 실행 수와 BLOCKER/MAJOR/MINOR 항목 수는 서로 다른 단위입니다.

## PR에서 확인하는 것

`evaluation-preview.yml`은 PR head 커밋을 고정해서 빌드하고 공개 예제를 실행합니다. 권한은 `contents: read`이며 모델 키나 평가용 environment를 사용하지 않습니다. artifact는 `public-summary.json` 하나만 올립니다.

`evaluation-comment.yml`은 preview 종료 후 별도 `workflow_run`으로 동작합니다. 기본 브랜치의 신뢰된 댓글 코드만 실행하며, PR 코드나 artifact를 실행하지 않습니다. artifact 크기·파일 수·JSON 필드·숫자·상태값을 검사한 뒤 고정 문구로 댓글을 만듭니다.

- 같은 저장소의 열린 PR이고 현재 head가 평가한 커밋과 일치할 때만 댓글을 작성합니다. fork PR은 Job Summary에서 확인합니다.
- 페이지를 순회해 기존 봇 댓글을 찾아 갱신합니다. head SHA, run ID, attempt를 표시하며 이전 실행이 최신 결과를 덮지 못하게 합니다.
- 현재 실행의 artifact가 없거나 검증되지 않으면 실패·누락 상태를 게시합니다. 이전 커밋의 완료 표시를 그대로 남기지 않습니다.
- 같은 run·attempt는 중복 게시하지 않습니다. artifact 오류를 해결한 뒤에는 평가 workflow를 재실행하여 attempt를 늘립니다.

`workflow_run` 파일은 기본 브랜치에 있어야 활성화됩니다. 따라서 이 기능을 처음 추가하는 PR에서는 preview를 확인할 수 있지만, sticky comment의 실제 동작은 기본 브랜치 반영 후에 확인해야 합니다. 현재 댓글 처리는 가짜 GitHub API를 사용한 테스트로 검증하며, 실제 API 댓글 게시까지 검증했다고 보지 않습니다.

수동 실행 버튼도 `workflow_dispatch`를 정의한 파일이 기본 브랜치에 반영된 뒤 표시됩니다. PR을 올린 것만으로 수동 실행이나 결과 댓글이 모두 활성화되지는 않습니다.

## 실제 모델을 로컬에서 실행하기

입력 형식은 [입력 데이터](data-format.md), 정답 준비는 [첫 평가](first-evaluation.md)를 따릅니다. 사례와 설정 경로는 `--data-root` 아래의 상대 경로이며, 설정의 `context_root`도 같은 데이터 디렉터리 안에 있어야 합니다. 심볼릭 링크로 외부 파일을 가리키는 입력은 거부합니다.

```bash
# API 키는 실행 환경에 설정합니다. 명령·JSON·커밋에 키를 적지 않습니다.
node scripts/evaluate-ci.mjs --mode claude --data-root /path/to/private-wiki \
  --cases eval/cases.jsonl --config eval/run.json \
  --model YOUR_PINNED_MODEL_ID --claude-version 2.1.322 \
  --max-budget-usd 0.10 --max-turns 12 --effort medium --timeout 120 \
  --out artifacts/actual-001
```

모델 ID와 CLI 버전은 사용할 수 있는 고정 값으로 지정합니다. 위 금액은 명령 형식의 예시이며 권장 예산이 아닙니다. 예산은 작업당 제한이고, 사례 × 조건 × 반복 횟수만큼 모델을 호출합니다. 이 CI 진입점은 한 번에 최대 50개 작업을 허용합니다. CLI의 비용 제한은 추정치이므로 정확한 전체 지출 상한을 보장하지 않습니다.

실행기는 설정 JSON에 적힌 모델·도구·runtime 라벨 대신 실제 명령의 모델, CLI 버전, effort, 턴·시간·비용 제한으로 실행 메타데이터를 고정합니다. 원문·WIKI·Skill 파일과 정답셋은 기존 `prepare` 절차로 기록합니다. 외부 어댑터 경로나 임의 셸 명령은 받지 않습니다.

완료 후 `raw/reviews.md`와 원문을 확인하여 `raw/reviews.jsonl`을 채우고, 기존 `report --reviews ...` 명령으로 다시 채점합니다. 처음 자동 실행한 보고서에는 사람 검토가 없으므로 이를 승인된 평가 결과로 사용하지 않습니다.

## 비공개 WIKI 레포에서 수동 호출하기

현재 이 프로젝트의 workflow는 공개 레포의 Actions에서 실제 모델 실행을 허용하지 않습니다. GitHub나 모델 API의 공통 제약이 아니라, 실제 CS·비공개 자료를 다루기 위해 정한 실행 범위입니다. 공개 가능한 평가셋과 보고서를 레포에서 관리하는 것은 별개입니다. 원답변과 검토 양식을 보관하는 Actions의 `claude` 모드는 다음 조건을 모두 요구합니다.

1. 호출한 레포가 비공개이고, 이벤트가 `workflow_dispatch`일 것
2. `upload-raw: true`로 비공개 artifact 보관을 명시할 것
3. `llm-evaluation` environment와 `ANTHROPIC_API_KEY`를 준비할 것
4. 평가 엔진과 자료를 모두 40자리 커밋 SHA로 고정할 것
5. 모델, 작업당 예산, 숫자 형태의 CLI 버전을 지정할 것

environment 이름을 YAML에 적었다고 승인 보호가 자동 구성되지는 않습니다. 저장소 관리자가 접근 범위·허용 브랜치·필요한 승인자를 설정해야 합니다. 비공개 artifact도 해당 레포에서 Actions 결과를 볼 수 있는 사용자에게 공개되며, 별도의 비밀 저장소는 아닙니다. 보관 기간은 7일입니다.

실행 후 `evaluation-private-review` artifact를 다운로드하여 `local/ci-review/`에 풉니다. `reviews.md`를 읽고 `reviews.jsonl`에 판정·이유·검토자·시점을 채운 뒤, 평가 때 사용한 **동일한 엔진 커밋**을 빌드하여 재채점합니다. 모델을 다시 호출할 필요는 없습니다.

```bash
node dist/cli.js report \
  --cases local/ci-review/cases.jsonl \
  --runs local/ci-review/experiment/runs.jsonl \
  --plan local/ci-review/experiment/plan.json \
  --reviews local/ci-review/reviews.jsonl \
  --out local/ci-review/reviewed-report.json
```

일부 응답만 검토했다면 검토자와 시점이 채워진 기록만 별도 JSONL에 담아 `--reviews`로 전달합니다. 독립된 holdout을 준비했고 C를 통과 대상으로 정했다면 위 명령에 `--check --condition C`를 추가할 수 있습니다. dev 파일럿만으로는 이 검사를 통과할 수 없습니다.

아래는 비공개 레포에 추가할 호출 예시입니다. `EVAL_COMMIT_SHA`는 workflow 파일과 실행 스크립트가 포함된 동일한 40자리 커밋으로 두 곳 모두 교체합니다. 현재 ALLCLL WIKI 레포에 이 파일을 설치하거나 키를 연결하지는 않았습니다.

```yaml
name: graduation-evaluation
on:
  workflow_dispatch:
    inputs:
      model:
        type: string
        required: true
      budget:
        type: string
        required: true
      claude-version:
        type: string
        required: true
      retain-review-files:
        type: boolean
        default: false
permissions:
  contents: read
jobs:
  evaluate:
    uses: allcll/graduation-wiki-eval/.github/workflows/evaluation.yml@EVAL_COMMIT_SHA
    with:
      mode: claude
      engine-ref: EVAL_COMMIT_SHA
      data-ref: ${{ github.sha }}
      cases: eval/cases.jsonl
      config: eval/run.json
      model: ${{ inputs.model }}
      max-budget-usd: ${{ inputs.budget }}
      claude-version: ${{ inputs.claude-version }}
      upload-raw: ${{ inputs.retain-review-files }}
    secrets:
      ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}
```

키 없이 연결만 확인하려면 `mode: sample`로 호출하고 `upload-raw: false`를 지정합니다. 이때는 평가 엔진에 포함된 공개 예제만 사용하며, 호출한 WIKI 내용을 평가하지 않습니다. reusable workflow의 Job Summary와 artifact는 호출한 레포에서 확인합니다. 외부 레포의 PR에 댓글까지 자동 설치하지는 않습니다.

커밋을 고정하고 Claude의 읽기 도구를 제한하는 것만으로 OS 격리가 만들어지지는 않습니다. 실제 평가 전에는 정답·이전 결과·운영 자격 증명에 대한 접근 범위를 제한하고 확인해야 합니다. 현재 CI 연결은 실제 모델 품질 측정이나 실행 환경의 격리 검증을 대신하지 않습니다.

공식 동작은 [workflow_run 이벤트](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#workflow_run), [재사용 workflow와 environment secret](https://docs.github.com/en/actions/how-tos/reuse-automations/reuse-workflows), [GitHub Actions의 권한과 입력 처리](https://docs.github.com/en/actions/reference/security/secure-use)를 참고했습니다.
