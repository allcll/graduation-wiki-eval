# 첫 실제 평가 준비

처음에는 실제 문의 3개를 A/B/C 조건에서 한 번씩 실행합니다. 총 9회로 입력 자료, 모델 연결, 사람 검토, 보고서가 이어지는지 확인하는 파일럿입니다. 이 결과만으로 전체 WIKI의 성능이나 개선 효과를 입증하지는 않습니다.

실제 사례가 3개보다 적다면 확보한 사례부터 시작합니다. 예제를 실제 CS로 바꾸어 표시하거나, 검토하지 않은 정답을 확정할 필요는 없습니다.

## 준비할 것 5개

| 준비물 | 준비할 내용 | 저장 위치 |
| --- | --- | --- |
| 실제 문의와 입력 조건 | 문의 원문에서 개인정보를 제거하고 입학년도·전공·문제 상황 등 판단에 필요한 정보를 남깁니다. 문의 당시 없었던 정보를 뒤늦게 채워 넣었다면 그 사실도 기록합니다. | `local/cases.jsonl`의 `question`, `inputs` |
| 정답과 원출처 | 적용되는 편람의 버전·페이지·조항과 확인할 사실을 정리합니다. 정보 부족이면 추가 질문, 규정 충돌이면 사람 확인 요청이 정답일 수 있습니다. 사람이 원문을 확인한 뒤 검토자와 검토 상태를 기록합니다. | 사례의 `expected`, `sources`, `oracle_reviewer`, `review_status` |
| 문항별 사람 채점 기준 | 답변에서 반드시 설명할 조건, 허용할 해석, 금지할 단정과 인용의 적합성을 문장으로 씁니다. 각 기준에 ID와 `answer` 또는 `evidence` 구분을 붙입니다. | 사례의 `rubric.version`, `rubric.criteria` |
| 모델이 읽을 자료 | 원문·WIKI·Skill을 파일로 준비하고 사용할 버전을 고정합니다. 원인 분석에 코드·기준 데이터가 필요하면 당시의 수정 전 버전도 포함합니다. | `local/context/`, `local/run.json`의 명시적 파일 목록 |
| 실행 환경과 검토자 | macOS/Linux, Node.js 22 이상, 지원하는 Claude Code CLI, 사용 가능한 고정 모델 ID, API 키, 작업당 실행 제한과 전체 예산을 준비합니다. 결과를 읽고 채점할 사람도 정합니다. | 키는 로컬 실행 환경에만 설정. 나머지는 `local/run.json`과 실행 기록 |

`local/`과 실행 결과는 기본적으로 Git에서 제외됩니다. API 키나 원본 학생 자료를 채팅·PR·공개 레포에 올리지 않습니다. 이름·학번·메일 주소는 제거하되, 판단에 필요한 입학년도와 전공까지 없애지는 않습니다.

정답은 WIKI나 이전 AI 답변에서 복사하지 않고 원문에서 확인합니다. `review_status: verified`는 실제로 사람이 확인한 사례에만 사용합니다. 파일 형식은 [입력과 실행 기록](data-format.md)을 참고하세요.

## 정답 파일과 모델 자료는 다릅니다

```text
평가자용                          모델에게 제공할 자료
cases.jsonl                      context/original/  원문 자료
  질문·입력                      context/wiki/      평가할 WIKI
  기대 행동·정답                 context/skills/    평가할 Skill
  원출처·채점 기준               필요한 수정 전 코드·기준 데이터
reviews.jsonl
  사람의 항목별 판정
```

실행기는 질문·입력과 조건별 자료를 전달합니다. 정답, 문항별 채점 기준, 사람 검토 기록은 모델 요청에 넣지 않습니다. 원문 편람을 읽게 하는 것은 허용하지만, 이 문의의 정답을 써 둔 해설·해결 PR·사후 분석 문서는 입력 자료에서 제외합니다.

파일을 나눈 것만으로 접근이 차단되는 것은 아닙니다. 현재 도구는 OS 샌드박스를 만들지 않습니다. 첫 실측 전에 모델 프로세스가 정답·이전 결과·운영 자격 증명에 접근하지 못하도록 실행 환경을 제한하고 확인해야 합니다. 접근 통제를 확인하지 못한 실험은 격리된 평가로 보고하지 않습니다. 자세한 범위는 [모델 연결](adapters.md)에 설명했습니다.

## 최초 실행 순서

1. 실제 사례와 원출처를 검토하고 문항별 채점 기준을 작성합니다. 최초 파일럿 사례는 `split: dev`로 두고, 독립적인 최종 평가 사례는 별도로 남깁니다.
2. `local/run.json`에 A/B/C, 반복 1회, 자료 목록, 모델·CLI 버전과 실행 제한을 기록합니다. 모든 조건에서 같은 모델·기본 지시·출력 형식을 사용합니다.
3. 아래 명령으로 입력을 검사하고 자료 스냅샷을 만듭니다. 여기까지는 모델을 호출하지 않습니다.

```bash
npm ci
npm run build
node dist/cli.js validate --cases local/cases.jsonl
node dist/cli.js prepare --cases local/cases.jsonl --config local/run.json --out artifacts/pilot-01
```

4. 준비된 자료와 실행 횟수를 확인한 뒤 모델을 호출합니다. `ANTHROPIC_API_KEY`를 실행 환경에 설정하고, 아래 모델 ID와 제한값을 실제 설정에 맞게 바꿉니다. 현재 어댑터는 구독 로그인 대신 API 키를 사용합니다.

```bash
node dist/cli.js run --plan artifacts/pilot-01/plan.json -- \
  node "$PWD/dist/adapters/claude.js" \
  --model YOUR_PINNED_MODEL_ID --max-budget-usd 0.10 \
  --max-turns 12 --effort medium --timeout 120
```

`0.10`은 명령 형식의 예시이며 권장 예산이나 실제 비용이 아닙니다. 제한은 작업당 적용되며, 3사례 × 3조건 × 반복 1회라면 9개 작업입니다. CLI의 비용 제한은 추정치이므로 확정 상한으로 해석하지 않습니다. 도구의 토큰 수집은 아직 없으므로 실제 사용량과 비용은 제공자 기록에서도 확인합니다. 실행기의 timeout은 어댑터 timeout보다 길게 설정합니다.

5. 검토 양식을 만들고 원문·모델 답변·문항별 기준을 함께 확인합니다. 각 기준에 판정과 이유를 적고, 검토자와 시점을 남깁니다. 자동 값 검사가 통과했더라도 틀린 학번의 규정을 인용하거나 중요한 예외를 누락했다면 해당 기준은 실패입니다.

```bash
node dist/cli.js review-template --cases local/cases.jsonl \
  --runs artifacts/pilot-01/runs.jsonl --plan artifacts/pilot-01/plan.json \
  --out local/pilot-01-reviews.jsonl
```

같이 생성된 `local/pilot-01-reviews.md`에서 질문·정답·근거·모델 원답변·기준을 읽고, JSONL의 `criterion_results`에 판정과 이유를 작성합니다. Markdown은 참고용이며 판정은 JSONL에서 읽습니다. 두 파일 중 하나라도 이미 있으면 새 이름을 사용합니다.

검토가 끝나기 전에는 빈 양식을 완료된 검토처럼 제출하지 않습니다. 일부 응답만 검토했다면 검토자와 시점이 채워진 기록만 별도 JSONL로 저장해 보고서에 전달할 수 있습니다. 나머지 실행은 검토 대기로 남습니다. 정답이나 채점 기준을 바꿨다면 기존 판정을 그대로 재사용하지 말고 새 계획과 검토를 준비합니다.

6. 검토 결과를 반영해 보고서를 만듭니다.

```bash
node dist/cli.js report --cases local/cases.jsonl \
  --runs artifacts/pilot-01/runs.jsonl --plan artifacts/pilot-01/plan.json \
  --reviews local/pilot-01-reviews.jsonl --out artifacts/pilot-01/report.json
```

dev 사례만 사용한 파일럿은 전부 맞혀도 holdout 판정이 `INCONCLUSIVE`인 것이 정상입니다. 먼저 사례별 답변·실패 이유·실행 오류·검토 대기를 확인하세요. 실행 실패를 분모에서 빼거나 성공한 재실행으로 덮어쓰지 않습니다. 다시 실행할 때는 `artifacts/pilot-02`처럼 새 경로를 사용합니다.

## 첫 평가 후 남길 내용

- 어떤 실제 사례와 자료 버전을 평가했는지
- 조건별로 확인한 성공·실패와 원인, 사람이 판단하기 어려웠던 기준
- WIKI 또는 Skill의 어떤 부분을 수정할지
- 재평가에서 무엇이 개선됐고 기존 사례에 새 실패가 생기지 않았는지

채점 기준이 애매한 사례는 다른 검토자와 판정을 비교해 기준을 먼저 보완합니다. 개선에 사용한 사례를 독립적인 최종 평가 사례로 다시 세지 않습니다. 사례를 늘릴 때는 같은 원인군이 dev와 holdout에 걸치지 않도록 나눕니다.

현재 CI는 평가 도구 자체를 합성 자료와 모의 프로세스로 검사합니다. WIKI PR에서 실제 모델을 호출하는 자동 평가, Skill 자동 선택과 코드 수정의 수행 평가는 아직 연결하지 않았습니다. 첫 실측은 현재 범위인 답변·근거·기대 행동의 검증부터 진행합니다.
