# graduation-wiki-eval

졸업요건 WIKI와 Skill의 변경 효과를 확인하는 TypeScript 평가 도구입니다. 같은 질문을 정해진 조건에서 실행하고, 답변의 정확성과 근거를 검토한 뒤 변경 전후의 실패를 비교합니다.

## 문제 상황

ALLCLL에서는 졸업요건 관련 문의가 들어오면 개발자가 문의 내용을 확인하고, WIKI와 QA Skill을 활용해 원인을 분석합니다. 규정의 해석이 잘못됐는지, 기준 데이터가 다른지, 코드가 의도대로 동작하지 않는지 살펴보는 과정입니다.

이 과정에서 한 사례를 해결했더라도 다른 학번이나 전공의 예외까지 올바르게 처리하는지는 별도로 확인해야 합니다. 문서를 고쳐 답변이 달라졌을 때도, 필요한 정보가 보강된 것인지 기존에 맞히던 질문을 놓치게 된 것인지 판단할 기준이 필요했습니다.

예를 들어 학점 숫자가 맞더라도 다른 학번의 규정을 인용했다면 올바른 답변으로 보기 어렵습니다. 입학년도가 없는 문의에는 추가 질문이 필요하고, 규정이 충돌하는 경우에는 근거 없이 하나를 선택해서는 안 됩니다.

## 배경과 목표

문의 접수부터 원인 분석까지 자동화하기에 앞서, 현재 WIKI와 Skill을 어느 범위까지 신뢰할 수 있는지 확인하고자 했습니다. 이 레포는 다음 질문에 답하기 위한 평가 절차를 코드로 옮긴 것입니다.

- WIKI를 제공했을 때 원본 자료만 제공한 경우보다 답변이 나아지는가?
- Skill을 추가하면 필요한 확인 절차와 예외 처리가 개선되는가?
- 발견한 문제를 고친 뒤, 기존에 성공하던 사례도 계속 통과하는가?

정답은 원문 편람이나 공식 확인 자료에서 작성합니다. 기존 WIKI는 평가 대상이며, 이 프로젝트의 작업 범위는 평가 명세·실행기·채점·회귀 비교입니다.

## 평가 방법

같은 모델·도구·출력 형식·실행 제한을 사용하고, 제공하는 자료를 구분합니다.

| 조건 | 제공 자료 | 비교 목적 |
| --- | --- | --- |
| A | 원본 편람·확인 자료와 필요한 코드·데이터 | 원본 자료만으로 수행한 기준선 |
| B | A + WIKI | 정리된 지식을 제공한 효과 |
| C | B + Skill 문서 | 작업 절차를 추가한 효과 |

```text
원출처 검토 → 정답·채점 기준 확정 → A/B/C 실행
                                  ↓
별도 사례로 재검증 ← WIKI·Skill 개선 ← 실패 분석·사람 검토
```

사실과 행동은 자동 검사하고, 인용의 적합성과 답변 전체의 해석은 사람이 검토합니다. 사례마다 답변·근거의 판정 기준을 먼저 적고, 검토자는 각 항목의 판정과 이유를 남깁니다. 모델이 출력한 자신감이나 링크의 존재만으로 정답 처리하지 않습니다.

개선에 사용하는 `dev`와 마지막에 확인하는 `holdout`은 규정·원인군 단위로 나눕니다. holdout 결과를 보고 수정했다면 해당 사례를 이후 독립 검증에 다시 사용하지 않습니다. 구체적인 기준은 [평가 설계](docs/design.md)에 정리했습니다.

## 실행하기

Node.js 22 이상이 필요합니다. 외부 어댑터 실행은 macOS/Linux를 지원합니다.

```bash
git clone https://github.com/allcll/graduation-wiki-eval.git
cd graduation-wiki-eval
npm ci
npm run build
node dist/cli.js demo --out artifacts/demo
```

데모는 가상 규정 3개를 A/B/C에서 실행합니다. 고정 응답을 반환하는 예제 어댑터를 사용하므로 모델 호출과 API 비용은 없습니다. 결과는 `artifacts/demo/report.md`와 `report.json`에 저장됩니다.

9개 응답의 자동 검사가 통과해도 합성 자료이고 사람 검토가 없으므로 품질 판정은 `INCONCLUSIVE`입니다. 실제 WIKI의 성능 점수가 아닙니다. 재실행할 때는 새 출력 경로를 지정합니다.

### 실제 자료 연결

처음 실행한다면 [첫 실제 평가 준비](docs/first-evaluation.md)에서 준비물과 순서를 확인하세요. 사례·정답·설정은 로컬에 두고, 실행할 때 조건별 파일 목록을 지정합니다. [입력 형식](docs/data-format.md)과 [모델 연결](docs/adapters.md)에 작성 예시가 있습니다.

```bash
node dist/cli.js validate --cases local/cases.jsonl
node dist/cli.js prepare --cases local/cases.jsonl --config local/run.json --out artifacts/baseline
node dist/cli.js run --plan artifacts/baseline/plan.json -- node "$PWD/local/agent.mjs"
node dist/cli.js review-template --cases local/cases.jsonl --runs artifacts/baseline/runs.jsonl \
  --plan artifacts/baseline/plan.json --out local/reviews.jsonl

# local/reviews.md에서 정답·근거·원답변·판정 기준을 확인합니다.
# local/reviews.jsonl에 검토자와 항목별 판정·이유를 작성합니다.
node dist/cli.js report --cases local/cases.jsonl --runs artifacts/baseline/runs.jsonl \
  --reviews local/reviews.jsonl --plan artifacts/baseline/plan.json --out artifacts/baseline/report.json

# 개선 버전을 별도로 실행한 뒤 비교합니다.
node dist/cli.js compare --baseline artifacts/baseline/report.json \
  --candidate artifacts/candidate/report.json --condition C --split holdout --out artifacts/comparison.json
```

패키지를 설치한 환경에서는 `node dist/cli.js` 대신 `grad-eval`을 사용할 수 있습니다. 평가 함수와 타입은 라이브러리 진입점에서도 제공합니다. 검토용 Markdown에는 정답이 포함되므로 모델 입력 자료에 넣지 않습니다.

v0.4부터 rubric의 각 항목에 `severity`가 필수입니다. v0.3 이하의 사례·계획·검토·보고서는 그대로 읽을 수 없습니다. [이전 버전에서 옮기기](docs/data-format.md#이전-버전에서-옮기기)를 참고하세요.

## 결과를 읽는 방법

| 상태 | 의미 |
| --- | --- |
| `PASS` | 검토된 실제 holdout의 계획 실행이 모두 완료되고 필수 검사를 통과함 |
| `FAIL` | 검토된 실제 holdout에서 필수 조건 실패가 확인됨 |
| `INCONCLUSIVE` | 합성 자료·미검토 정답·누락·실행 오류 등으로 품질 판단을 보류함 |

자동으로 비교하는 행동·사실과 사람 검토의 `blocker`·`major` 항목은 필수 기준입니다. `minor` 실패는 개선 권고로 남기므로, 다른 조건이 충족되면 PASS와 함께 표시될 수 있습니다. 다만 minor도 검토하지 않았다면 `pending`이며, 미검토 항목이 남은 상태는 통과하지 않습니다. 심각도별 실패 수와 실행 오류·검토 대기는 보고서에서 구분합니다.

누락·오류·검토 대기는 분모에서 빼지 않습니다. 변경 전후에는 성공→실패와 실패→성공을 각각 기록해 평균 점수에 가려진 회귀를 확인합니다. 원문·모델 설정·정답셋이 함께 달라진 결과는 같은 실험으로 비교하지 않습니다. PASS는 해당 사례 범위의 결과이며 자동 배포 승인이 아닙니다.

`report --check`는 계획한 모든 조건의 holdout 판정을 검사합니다. A/B를 참고용으로 두고 C만 통과 대상으로 정했다면 `--check --condition C`를 사용합니다. 종료 코드만 C를 기준으로 결정하며 A/B 결과는 보고서에 그대로 남습니다. [종료 코드와 조건 선택](docs/data-format.md#종료-코드)에 사용 예시가 있습니다.

## 구현에서 신경 쓴 부분

- **입력 경계:** 파일에서 읽은 JSON을 검증하기 전에는 신뢰하지 않습니다. Zod 스키마에서 런타임 검사와 TypeScript 타입을 함께 정의합니다.
- **실행 상태:** 성공과 오류를 `status`로 구분합니다. 성공 결과에는 응답과 해시가, 오류 결과에는 오류 원인이 있어야 합니다.
- **변경 추적:** 자료·설정·출력의 해시를 기록하고, 응답이 바뀌면 이전 사람 검토를 재사용하지 못하게 합니다.
- **실행 보존:** 타임아웃과 실패를 기록하며, 이미 시작한 실험을 덮어쓰거나 자동으로 다시 실행하지 않습니다.

`strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`를 켜고, 외부 데이터 검증은 타입 검사와 별도로 수행합니다. CLI가 없어도 같은 평가 함수를 사용할 수 있도록 입출력 처리와 채점 로직을 분리했습니다.

## 현재 범위

평가 실행·사람 검토 연결·보고서·회귀 비교와 Claude Code 참조 어댑터를 구현했습니다. 테스트와 CI는 합성 자료와 모의 프로세스를 사용하며, **실제 ALLCLL 정답셋 검토와 모델 성능 측정은 아직 진행 전**입니다.

Claude 어댑터의 C 조건은 제공된 Skill 문서를 활용하는 방식입니다. 네이티브 Skill 자동 탐색·선택 평가는 포함하지 않습니다. 실행기도 OS 샌드박스를 만들지는 않으므로, 실측 환경에서는 정답 파일·이전 결과·운영 자격 증명의 접근 범위를 별도로 제한해야 합니다. 비공개 WIKI와 학생·CS 자료는 이 레포에 포함하지 않습니다.

## GitHub Actions에서 실행하기

이 레포의 PR에서는 공개 예제를 실행해 CLI 연결과 보고서 생성을 확인합니다. 댓글에는 집계만 남기며, 새 결과가 나오면 같은 댓글을 갱신합니다. 댓글용 workflow는 기본 브랜치에 반영된 뒤부터 작동합니다.

실제 모델 평가는 사람이 시작하는 방식입니다. 공개 레포에서는 로컬에서 실행하고, 비공개 레포에서는 재사용 workflow를 연결해 답변과 검토 양식을 보관할 수 있습니다. 로컬과 CI 모두 같은 CLI와 채점 기준을 사용합니다. 모델 호출만 끝난 상태는 사람 검토 대기이며, Actions의 성공 표시가 품질 통과를 뜻하지는 않습니다.

```bash
npm run build
node scripts/evaluate-ci.mjs --mode sample --out artifacts/ci-preview-01
```

위 명령은 API 키 없이 PR과 같은 예제를 실행합니다. 실제 자료 연결, 수동 실행, 결과 보관과 첫 설정 순서는 [GitHub Actions 연결](docs/actions.md)에 정리했습니다. 비공개 WIKI의 workflow와 실제 정답셋은 아직 연결하지 않았습니다.

## 개발과 참고 자료

```bash
npm run check   # 타입 검사, 빌드, 테스트
npm run check:package  # 패키지 설치 후 CLI·라이브러리·데모 확인
npm pack        # CLI·라이브러리·예제를 포함한 설치 패키지 생성
```

`src/schema.ts`는 입력 계약, `evaluate.ts`와 `compare.ts`는 채점과 회귀 비교, `runner.ts`는 실행 준비와 기록을 담당합니다. `cli.ts`는 이 기능을 명령행으로 연결합니다.

변경은 작업 브랜치에서 진행하고 PR로 main에 반영합니다. [PR 양식](.github/pull_request_template.md)에 문제 상황, 원인, 작업 내용과 검증 결과를 남긴 뒤 CI 결과와 변경 코드를 검토합니다. 서로 의존하는 PR은 선행 작업을 본문에 연결합니다.

평가 설계에는 토스의 업무별 평가와 Skill Rubric, GitLab의 회귀 검사, Shopify의 채점기 검증, Ring의 지식 버전 비교 사례를 참고했습니다. 적용 범위와 원문은 [참고 자료](docs/references.md)에 정리했습니다.
