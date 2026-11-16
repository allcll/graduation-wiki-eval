# 저장된 답변을 Claude로 채점하기

문구 검사만으로 판단하기 어려운 표 인용을 원문 페이지와 함께 대조합니다. 답변을 다시 생성하지 않고 선택한 인용만 채점하며, 모델 의견은 기존 코드 검사 옆에 별도로 남습니다.

| 항목 | 확인할 내용 |
| --- | --- |
| 원문 재현 | 직접 인용의 단어·숫자·단위가 원문과 같은가? `3`에 `학점`을 추가하면 의미가 맞아도 이 항목은 불충족 |
| 의미·표 관계 | 인용이 표현한 사실과 행·열·병합셀 관계가 맞는가? 동일과목을 대체과목으로 옮기면 불충족 |
| 적용 적합성 | 질문의 학번·학과·시점·예외에 적용되는 근거인가? |

항목별로 `pass / fail / uncertain`, 이유, PDF 페이지, 짧은 발췌·표 위치를 받습니다. 발췌문도 모델 출력이므로 그 자체가 정확성의 증거는 아닙니다. 실제 PDF 페이지 전달 기록이 없으면 검증된 판정으로 집계하지 않습니다. 기준은 [judge-spec.ts](../src/judge-spec.ts)에 고정하고 바뀌면 새 계획을 만듭니다.

## 준비

`local/judge/selection.json` 예시입니다. 인용 번호는 0부터, PDF 페이지는 1부터 셉니다.

```json
{
  "schema": "graduation-wiki-eval/judge-selection-v1",
  "source_contract": "context/sources/original/source-contract.json",
  "samples": [
    {
      "job": "../../artifacts/your-saved-run/jobs/C-0001-001",
      "citation_indices": [0, 1],
      "evidence_pages": [52, 53]
    }
  ]
}
```

`job`과 선택적인 `table_index`는 selection 파일 기준, `source_contract`는 원래 작업 폴더 기준입니다. 인용 페이지와 판단에 필요한 인접 페이지·각주를 포함합니다.

```sh
npm run build
node dist/cli.js judge-prepare \
  --cases local/your-original-cases.jsonl \
  --manifest local/judge/selection.json \
  --out artifacts/your-judge-pilot
```

실행 당시의 전체 사례 파일이 필요합니다. 원문·질문·답변 해시를 확인해 별도 폴더에 입력과 PDF를 준비합니다. 입력에는 질문·저장 답변·정답 초안·문항 기준·선택 페이지 추출문을 담습니다. **A/B/C 조건 이름, 기존 검사 결과, 표본 분류·예상 판정은 모델에게 주지 않습니다.** 정답은 채점용 모델에만 제공합니다.

예상 판정은 모델 실행 전에 다음 형식의 `references.json`으로 작성합니다. 실행 시작 시 참조 해시를 고정하고, 이후 참조가 바뀌면 보고서 생성을 거부합니다.

```json
{
  "schema": "graduation-wiki-eval/judge-references-v1",
  "plan_sha256": "sha256:plan.json의_해시",
  "reviewer_kind": "assistant_draft",
  "human_review": "pending",
  "entries": [
    {
      "sample_id": "sample-01",
      "answer_sha256": "sha256:선택한_답변의_해시",
      "citation_index": 0,
      "category": "normal",
      "expected": { "quote_fidelity": "pass", "source_relation": "pass" },
      "source_pages": [52],
      "reason": "원문에서 확인한 문구·관계와 예상 판정의 이유"
    }
  ]
}
```

해시 자리에는 실제 값을 넣습니다. 선택한 인용마다 한 항목이 필요하며 분류는 `normal / unsupported_table / actual_error`입니다. 이번 참조 파일은 AI가 원문을 대조한 초안만 받으며 사람의 정답으로 집계하지 않습니다.

## 구독으로 실행

```sh
node dist/cli.js judge-run \
  --plan artifacts/your-judge-pilot/plan.json \
  --references local/judge/references.json \
  --model claude-sonnet-4-6 --usage-credits-disabled \
  --max-turns 6 --timeout 180
```

이 명령만 실제 모델을 호출합니다. Claude Code 구독 인증을 확인하고 API 키·다른 공급자 설정이 있으면 중단합니다. API 키나 다른 모델로 전환하는 경로는 없습니다. 추가 사용량이 꺼져 있다는 계정 설정을 전제로 하며, 플래그가 결제 설정을 변경하거나 자동 확인하지는 않습니다.

최대 10개 답변, 답변당 인용 8개·원문 페이지 8개의 표본용 실행기입니다. 순차 실행하며 첫 오류에서 중단하고 자동 재시도하지 않습니다. 이미 시작한 계획도 재실행할 수 없습니다. 한 CLI 세션에 Read와 구조화 출력 등 여러 모델 턴이 쓰이므로 답변 1개가 모델 요청 1회와 같지는 않습니다.

Read만 제공하며 원문 외 파일 읽기를 발견하면 판정을 거부합니다. 이 제한은 운영체제 샌드박스가 아닙니다. 판정 원문·도구 기록은 로컬에 보관하고 공개 보고서는 필요한 근거만 골라 게시합니다.

## 보고서

```sh
node dist/cli.js judge-report \
  --plan artifacts/your-judge-pilot/plan.json \
  --references local/judge/references.json \
  --out artifacts/your-judge-pilot-report
```

원문 재현·의미 관계 두 항목의 초안 일치·불일치·미평가와 **불충족 초안을 모델이 통과시킨 항목**을 따로 집계합니다. 적용 적합성은 모델 의견으로 표시하고 초안 일치 수에는 넣지 않습니다. 누락·실행 오류·페이지 미확인은 분모에서 빼지 않습니다.

초안과 다르면 모델·참조 양쪽을 원문으로 다시 확인해야 합니다. 사람이 확정한 참조 판정이 없으므로 초안 일치율을 채점기의 검증된 정확도로 보고하지 않습니다. 선택한 개발 표본의 결과를 전체 60개나 미검증 43개의 성능으로 일반화하지 않습니다.

현재는 모델 판정의 검증 단계입니다. 기존 코드 실패, `report --check`, 사람 검토와 전체 품질 판정은 바꾸지 않습니다.
