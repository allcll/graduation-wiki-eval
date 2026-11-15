# 편람을 읽고 인용했는지 확인하기

숫자가 정답과 같아도 근거가 다른 판본이면 답변을 그대로 채택하기 어렵습니다. `--source-contract`는 Claude Code가 지정한 편람의 페이지를 실제로 전달받았는지, 인용 문구가 그 페이지에 있는지 검사합니다. 정답값 검사나 사람의 해석 검토를 대신하지 않습니다.

## 검사하는 범위

1. 모델 호출 전에 편람 PDF·검색용 텍스트의 SHA-256과 요청의 `policy_edition` 또는 기존 평가셋의 `policy_term`을 확인합니다. 둘 다 있으면 모두 원문 판본과 같아야 하며, 누락·충돌 시 호출 전에 중단합니다. 질문이나 평가셋은 자동 수정하지 않습니다.
2. 모델이 관련 내용을 검색하고 PDF의 해당 페이지를 Read로 열도록 지시합니다.
3. 실제 도구 결과의 첫 페이지·페이지 수와 전달된 이미지 블록 수를 확인합니다. 요청에 `pages`를 적은 것만으로 읽었다고 처리하지 않습니다.
4. 인용마다 판본·출처 ID·PDF 페이지를 검사합니다. 인용한 페이지를 실제로 읽었어야 합니다.
5. 일반 문장은 원문 텍스트와 대조합니다. 표 인용은 `--table-index`가 있으면 과목·학점이 같은 행에 있고, 영역·제외 계열의 병합 셀이 해당 행들을 포함하는지 확인합니다. 표 관계가 충돌하면 우연히 평문 문자열이 일치해도 통과시키지 않습니다.

검색 결과, WIKI 읽기, 캐시 응답, 실패한 Read는 원문 페이지 읽기를 대신하지 않습니다. PDF 전체를 반환하는 구형 결과나 페이지 메타데이터가 없는 결과도 추측해서 통과시키지 않습니다. 현재는 Read의 `parts` 결과와 이미지 블록을 지원합니다. 형식은 [Claude SDK의 Read 결과 명세](https://code.claude.com/docs/en/agent-sdk/typescript#read)를 기준으로 했습니다.

## 자료 준비

[2026-2 편람 메타데이터 예시](experiments/handbook-2026-2.source-contract.json)는 출처 ID, 판본, PDF·텍스트 경로와 해시, 전체 페이지 수만 포함합니다. 정답이나 해당 문항의 정답 페이지는 넣지 않습니다.

편람은 [학교의 공식 공지](https://www.sejong.ac.kr/kor/intro/notice3.do?articleNo=891086&mode=view)에서 받은 파일입니다. 텍스트는 아래와 같이 추출했고, 이번 평가에서는 기존 검색용 텍스트와 다시 추출한 결과가 바이트 단위로 같음을 확인했습니다.

```sh
pdftotext -layout handbook-2026-2.pdf handbook-2026-2.txt
```

페이지 끝의 form feed(`\f`)를 유지해야 합니다. PDF 첫 페이지를 1로 세며, 인쇄된 쪽 번호를 임의로 사용하지 않습니다. 공백과 줄바꿈은 인용 대조 시 제거하고 Unicode NFC 정규화를 적용합니다. 일반 문장의 수정·요약은 정확한 인용으로 인정하지 않습니다. 표는 아래 형식과 원본 셀 관계에 맞는 조합을 별도로 검사합니다.

메타데이터는 **담당자가 확인한 원문과 추출본의 연결**입니다. 해시가 맞다는 사실만으로 PDF가 학교의 공식 판본인지, 텍스트를 올바르게 추출했는지 자동 인증되지는 않습니다. 새 판본은 공식 배포처와 추출 결과부터 확인하고 해시·페이지 수를 갱신해야 합니다. 이전 판본의 메타데이터를 덮어쓰지 않습니다.

PDF·텍스트·메타데이터 세 파일 모두 실행 설정의 `sources`에 명시합니다. 메타데이터 내부 경로는 prepare 이후 작업 폴더 기준의 `context/sources/...` 경로입니다. 실행기가 세 파일을 함께 복사하고 해시를 고정합니다.

## 표 인용 자료

[2026-2 PDF 53쪽 표 인덱스](../datasets/graduation-2026-2/source-indexes/handbook-2026-2-p53.tables.json)는 해당 균형교양 표 전체의 셀 50개를 담습니다. 각 셀에 행·열, 병합 범위, 좌표와 원문 텍스트를 보존했습니다. 빈 추출 칸을 이전 값으로 임의 채우지 않습니다.

표 인덱스는 채점 자료로만 읽으며 모델 요청이나 기존 질문에 추가하지 않습니다. 원문 PDF 해시·판본·페이지와 묶어 검사하고, 사용한 인덱스의 해시는 결과에 기록합니다. 현재는 이 표 하나를 준비했습니다. 다른 표까지 자동으로 분석하거나 검증하지 않습니다. 추출 방법과 검토 상태는 [표 인덱스 안내](../datasets/graduation-2026-2/source-indexes/README.md)를 참고하세요.

지원하는 조합은 `영역 + (과목·학점 한 쌍 이상) + 선택적인 공통 제외 계열`입니다. 셀 문구는 그대로 사용하고, 여러 과목을 인용하면 모두 같은 영역에 속해야 합니다. 제외 계열을 덧붙였다면 그 셀이 모든 해당 행을 포함해야 합니다. 단어가 같은 페이지에 흩어져 있다는 사실만으로 통과하지 않으며, 한 인용이 여러 표 관계에 동시에 맞는 경우도 자동 통과시키지 않습니다. 관계를 판단할 수 없는 표현은 원문 문구로 나누거나 별도 검토해야 합니다.

## 새 모델 응답을 받을 때

새 출력 폴더에 `prepare`한 다음, 기존 구독 실행 명령에 옵션을 추가합니다.

```sh
node dist/cli.js run --plan artifacts/new-run/plan.json -- \
  node "$PWD/dist/adapters/claude.js" --auth subscription --usage-credits-disabled \
  --trace-tools --require-skill-reads \
  --source-contract context/sources/original/source-contract.json \
  --table-index "$PWD/datasets/graduation-2026-2/source-indexes/handbook-2026-2-p53.tables.json" \
  --model claude-sonnet-4-6 --max-turns 12 --effort medium --timeout 180
```

구독 모드의 전제와 인증 방식은 [연결 가이드](adapters.md)를 따릅니다. API 키 경로에서도 같은 검사를 쓸 수 있지만, 이번 실측은 구독 경로만 사용했습니다. OpenAI 어댑터에는 이 옵션을 적용하지 않았습니다.

모델의 `citations`는 기존 문자열 배열을 유지하면서 다음 형식을 사용합니다.

```text
[source=SOURCE_ID;edition=EDITION;pdf_page=N] 해당 페이지에서 그대로 옮긴 짧은 문구
```

검사를 켠 실행에서는 모든 항목이 지정 원문의 인용이어야 하며 최소 1개가 필요합니다. 최소 8자 제한은 제거했습니다. 실제 존재하는 짧은 셀도 인용할 수 있고, 공백뿐인 문구는 허용하지 않습니다. 출력 크기 제한인 공백 제외 최대 600자는 유지합니다. WIKI·Skill의 위치를 이 배열에 넣으면 통과하지 않습니다. 원문 근거가 없는 답변까지 폭넓게 평가하려면 이 실행 조건을 그대로 적용하지 말고 사례의 목적에 맞는 별도 조건을 정해야 합니다.

## 저장된 응답만 다시 검사할 때

`source-recheck`는 모델을 호출하지 않습니다. 기존 작업의 요청·도구 기록·거절된 답변·원문 해시를 먼저 맞춰 본 뒤 새 검사 결과만 저장합니다. 과거 응답을 새 기준으로 재채점하는 작업이므로 이전 run의 오류 상태나 품질 보고서를 고쳐 쓰지 않습니다.

```sh
node dist/cli.js source-recheck \
  --job artifacts/cs-001-source-check-2026-11-15/jobs/C-0001-001 \
  --source-contract context/sources/original/source-contract.json \
  --table-index datasets/graduation-2026-2/source-indexes/handbook-2026-2-p53.tables.json \
  --out artifacts/your-new-recheck/recheck.json
```

출력은 `mode: offline_recheck`, `model_calls: 0`이며 입력 기록의 해시와 `source-check-v2` 검사 결과를 포함합니다. CLI 종료 코드 0은 재검사 파일 생성 성공을 뜻하고, 통과 여부는 `source_check.status`를 확인합니다. 기존 출력 파일에는 덮어쓰지 않습니다. 최초 `source-check-v1` 기록은 그대로 읽을 수 있으나, 전달된 페이지를 확인할 수 없는 불완전한 도구 기록은 재검사하지 않습니다.

## 결과 읽기

작업 폴더의 `claude-tools.json`에 실제 전달된 페이지가, `source-check.json`에 항목별 검사와 구조화된 모델 답변이 저장됩니다. 원문 이미지, 원문 전체 텍스트, 사고 과정, 인증 정보는 저장하지 않습니다. 모델 답변에는 사례 내용이 포함될 수 있으므로 두 파일은 로컬 실행 기록으로 관리합니다.

| 결과 | 처리 |
| --- | --- |
| `pass` | 출처·페이지 읽기·문구 위치 또는 표 셀 관계 검사 통과. 일반 정답값 검사와 사람 검토로 이어짐 |
| `fail` | 정상 답변으로 채택하지 않고 실행 오류로 기록. 거절된 답변은 `candidate_output`에 보존 |
| `not_evaluated` | 시간 초과·응답 파싱 실패 등으로 검사까지 도달하지 못함 |

출력 파일이 이미 있으면 덮어쓰거나 모델을 다시 호출하지 않습니다. 인용 검사 실패 시 자동 재시도도 하지 않습니다. `model_config`에 옵션 사용을 기록하고, 이전 계획과 별도의 새 계획으로 실행하세요. 어댑터 지시와 자료 구성이 달라지므로 WIKI만 바꾼 실험으로 비교할 수 없습니다.

`source-check-v2`는 `literal_match`, `match_basis`, `table_match`에 평문 대조와 표 관계 대조를 구분해서 남깁니다. 표 결과에는 사용한 셀 ID와 행 번호가 들어갑니다. 인덱스가 없는 표는 셀 관계를 확인했다고 기록하지 않습니다.

`semantic_support`는 항상 `requires_review`입니다. 실제 문구를 옮겨도 다른 학번의 규정일 수 있고, 필요한 예외를 인용하지 않았거나 표의 열을 잘못 해석했을 수 있습니다. **정답값 일치 / 원문·인용 검사 / 적용 대상과 의미 검토**를 나누어 확인합니다.
