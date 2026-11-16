# 저장된 답변으로 보고서 다시 만들기

검사기를 바꾼 뒤 같은 답변을 다시 확인할 때 `recheck-report`를 사용합니다. 모델을 다시 부르지 않고, 이전 작업 폴더에서 응답·읽기 기록·원문을 읽어 JSON과 Markdown 보고서를 만듭니다.

## 준비할 파일

- 실행 당시 사용한 전체 사례 파일. 일부 사례만 골라 새로 저장하면 데이터셋 해시가 달라집니다.
- 각 작업의 `request.json`, `result.json`, `claude-tools.json`, `source-check.json`과 원문 컨텍스트.
- 선택할 작업 목록을 적은 manifest. 표 인덱스와 별도 분석 메모는 선택 사항입니다.

`local/recheck/manifest.json` 예시:

```json
{
  "schema": "graduation-wiki-eval/offline-report-input-v1",
  "source_contract": "context/sources/original/source-contract.json",
  "table_index": "../../datasets/graduation-2026-2/source-indexes/handbook-2026-2-p53.tables.json",
  "jobs": [
    "../../artifacts/your-saved-run/jobs/A-0001-001",
    "../../artifacts/your-saved-run/jobs/B-0001-001",
    "../../artifacts/your-saved-run/jobs/C-0001-001"
  ]
}
```

`jobs`, `table_index`, `analysis_notes` 경로는 manifest 기준입니다. `source_contract`만 **각 작업 폴더 기준의 허용된 원문 경로**입니다.

```sh
npm run build
node dist/cli.js recheck-report \
  --cases local/your-original-cases.jsonl \
  --manifest local/recheck/manifest.json \
  --out artifacts/your-new-offline-report
```

`report.json`과 `report.md`가 생깁니다. 출력 폴더가 이미 있으면 거부합니다. 종료 코드 0은 보고서 생성 완료이며 품질 통과를 뜻하지 않습니다.

## 보고서에서 나누어 보는 것

| 항목 | 의미 |
| --- | --- |
| 응답 생성 | 모델 프로세스가 정상 종료하고 완전한 응답·도구 기록이 남았는지 |
| 정답값 | 저장된 `action`·`facts`가 실행 당시 정답과 일치하는지 |
| 편람 읽기·인용 | 출처·판본·페이지 읽기·문구 또는 지원하는 표 관계를 확인했는지 |
| Skill 읽기 | 당시 필수 읽기로 선언한 문서의 전체 읽기 기록이 있는지 |
| 사람 검토 | 해당 규정이 질문의 대상·조건·예외에 맞는지. 이 명령에서는 항상 대기 |

인용 판정은 `pass`(검사 범위에서 확인), `fail`(위반 확인), `inconclusive`(현재 검사기로 판단 불가)입니다. 실패와 판단 불가가 함께 있으면 대표 상태는 실패이고 상세에는 둘 다 남깁니다. `automatic_fail`과 `automatic_inconclusive` 집계는 겹칠 수 있으며, 정답값 검사는 별도 열입니다.

기존 어댑터가 인용 실패를 `adapter_exit_2`로 남겼어도, 저장된 모델 프로세스의 정상 종료와 완전한 응답이 확인되면 이 보고서에는 `execution_status: completed`를 표시합니다. 과거 `result.json`을 수정하지 않으며 `original_run_status`와 오류를 함께 보존합니다.

이 명령은 **완전하게 저장된 응답의 재검사**만 다룹니다. 시간 초과·잘린 도구 기록·원문 해시 불일치·사례 변경은 보고서 생성을 거부합니다. 전체 계획의 미실행·실행 실패 집계는 기존 `report`에 남아 있습니다. 선택한 응답만으로 전체 실행률이나 품질을 계산하지 않으므로 `quality_gate`는 `NOT_EVALUATED`입니다.

필수 Skill 읽기 목록이 없는 C 기록도 추측해서 복원하지 않습니다. 명시적으로 빈 목록이면 읽기 검사는 `not_requested`입니다. 본문을 요청에 포함한 것과 Read로 열어본 것은 구분합니다.

## 분석 메모를 함께 남길 때

원문 대조에서 발견한 오타나 미지원 표를 메모로 붙일 수 있습니다. manifest의 `analysis_notes`에 다음 파일을 지정합니다.

```json
{
  "schema": "graduation-wiki-eval/citation-analysis-notes-v1",
  "reviewer_kind": "assistant_analysis",
  "human_review": "pending",
  "source_pdf_sha256": "sha256:원문_파일_해시",
  "entries": [
    {
      "run_id": "A-0001-001",
      "output_sha256": "sha256:답변_해시",
      "citation_index": 0,
      "citation_sha256": "sha256:전체_인용_문자열의_digest",
      "category": "table_relationship_unhandled",
      "reason": "원문과 대조해서 확인한 내용"
    }
  ]
}
```

해시 자리에는 실제 SHA-256 값을 넣습니다. 답변과 전체 인용 문자열은 도구의 `digest`, PDF는 파일 바이트의 SHA-256을 사용합니다. 인용 해시에는 출처·판본·페이지 접두부도 포함합니다.

메모는 자동 판정을 바꾸지 않습니다. 답변·인용·원문이 바뀌면 메모를 재사용할 수 없고, 목록에 없는 응답의 메모도 거부합니다. AI 분석을 사람의 검토 완료로 기록하지 않습니다.

실제 적용 결과는 [저장 응답 60개 재검사](experiments/execution-evaluation-recheck.md)에 정리했습니다.
