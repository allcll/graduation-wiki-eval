# 입력과 실행 기록

사례·실행·사람 검토는 JSON 배열 또는 JSONL로 읽습니다. JSONL은 한 줄에 객체 하나를 넣습니다. 설정·계획·보고서는 JSON 객체입니다. 중복 키와 NaN/Infinity는 허용하지 않습니다.

## 사례

아래는 가상 규정의 예시입니다. 실제 정책 정답으로 사용하지 않습니다.

```json
{
  "id": "sample-credits",
  "family": "sample-general-credits",
  "split": "dev",
  "origin": "synthetic",
  "review_status": "draft",
  "oracle_reviewer": null,
  "independent_reference": false,
  "question": "2024학번 일반전공 학생이 112학점을 이수했다. 총 학점 기준에서 몇 학점이 부족한가?",
  "inputs": {"admission_year": 2024, "completed_credits": 112},
  "expected": {"action": "answer", "facts": {"remaining_credits": 8}},
  "sources": [{
    "id": "sample-credits",
    "version": "sample-v1",
    "locator": "original.md#sample-credits",
    "excerpt": "가상 일반전공의 2024년 입학생 기준은 120학점이다.",
    "authoritative": false
  }]
}
```

| 필드 | 작성 기준 |
| --- | --- |
| `family` | 같은 규정·예외·원인군. dev와 holdout에 걸치면 오류 |
| `origin` | 실제 업무 사례 `real`, 도구 검증용 가상 사례 `synthetic` |
| `review_status` | 초안 `draft`, 원출처를 사람이 확인한 정답 `verified` |
| `oracle_reviewer` | 정답 검토자. verified일 때 필수 |
| `independent_reference` | WIKI 답변을 복사하지 않고 원출처에서 정답을 작성했는지 |
| `sources` | 적용 대상과 시점에 유효한 출처·버전·페이지·근거 |
| `expected.facts` | 정확히 비교할 구조화된 값. 부가 키도 불일치로 판정 |
| `inputs` | 모델에 제공할 작업 입력. expected·정답표·검토 기록을 넣지 않음 |

모호한 정책에는 확정 수치를 만들지 않고 추가 질문이나 사람 확인을 기대 행동으로 정합니다. 본문의 예외·모순·근거 적합성은 자동 값 검사와 별도로 사람이 검토합니다. 검토 기준을 바꾸면 사례 버전도 달라지므로 이전 결과를 그대로 합치지 않습니다.

## 실행 설정

`local/run.json` 예시입니다. `context_root`는 이 설정 파일을 기준으로 해석합니다. 실제 사용하는 파일·모델·제한값으로 바꿔야 합니다.

```json
{
  "context_root": "context",
  "sources": ["original/2024.md"],
  "wiki": ["wiki/2024.md"],
  "skills": ["skills/query.md"],
  "conditions": ["A", "B", "C"],
  "repeats": 1,
  "timeout": 150,
  "execution": "real",
  "model": "REPLACE_WITH_PINNED_MODEL_ID",
  "model_config": "effort=medium;max-turns=12;budget-usd=0.10;adapter-timeout=120",
  "prompt": "graduation-query-v1",
  "code": "none",
  "data": "none",
  "tools": "Read,Grep,Glob",
  "runtime": "REPLACE_WITH_CLAUDE_CLI_AND_ADAPTER_VERSION",
  "instructions": "답변 가능하면 facts는 remaining_credits 정수만 담는다. 추가 질문이면 required_fields 배열, 규정 충돌이면 reason: source_conflict만 담는다."
}
```

위 instructions는 예제의 학점 질의용 형식입니다. 원인 분류 등 과제가 달라지면 해당 출력 계약으로 바꾸되 모든 비교 조건에 동일하게 제공합니다. 정답 값이나 올바른 행동을 특정 사례에 맞춰 알려주는 지시는 넣지 않습니다.

파일은 명시적으로 나열합니다. 디렉터리 전체 복사나 glob은 지원하지 않습니다. 경로 이탈·외부로 나가는 심볼릭 링크·`.git`·`.env`·학생 자료 폴더 등은 거부하지만 파일 내용의 개인정보나 정답 유출을 자동 판별하는 기능은 아닙니다.

`prepare`는 원문/WIKI/Skill 파일을 조건별 디렉터리에 복사하고 해시·바이트 크기를 남깁니다. 원본을 나중에 수정해도 준비된 실험은 복사본을 사용합니다. 준비된 파일을 수정하거나 새 파일을 추가하면 실행을 거부합니다. 설정의 `instructions`와 출력 계약도 프롬프트 지문에 포함합니다.

## 실행 계획

`prepare`가 생성한 `plan.json`에는 자료 스냅샷과 `evaluation_plan`이 있습니다. `report`는 이 계획의 사례 × 조건 × 반복 횟수를 사용합니다. 누락된 응답에 맞춰 분모를 줄이지 않습니다.

다른 실행기에서 만든 결과를 가져오려면 먼저 계획을 고정합니다.

```bash
node dist/cli.js plan --cases local/cases.jsonl --conditions A,B,C --repeats 3 --out local/plan.json
```

해시는 변경 감지용입니다. 기록자의 신원, 실제 원문의 권위 또는 프로세스 격리를 인증하지 않습니다. 계획·입력·결과를 함께 임의 변경하는 행위까지 막는 서명 시스템은 아닙니다.

## 실행·어댑터 계약

어댑터는 요청 JSON 하나를 stdin으로 받고 다음 응답 객체 하나만 stdout에 씁니다. 진행 로그는 stderr를 사용합니다.

```json
{
  "action": "answer",
  "facts": {"remaining_credits": 8},
  "answer_text": "[가상 사례] 주어진 120학점 기준으로 8학점이 부족합니다.",
  "citations": ["context/sources/original/2024.md#sample-credits"]
}
```

실행기는 case/condition/repeat, 원출력·오류, 모델·자료 버전, 경과 시간을 자동 기록합니다. 실행 명령 인수와 명시적인 로컬 실행 파일의 해시도 버전 비교에 포함합니다. 토큰 수는 현재 외부 어댑터에서 수집하지 않으므로 `null`입니다. 메타데이터의 모델·환경 선언은 실제 호출과 일치시켜야 합니다.

작업당 stdout/stderr/result가 로컬에 남습니다. 시작한 실험은 성공 여부와 관계없이 재실행하지 않습니다. 재평가하려면 새로운 경로에 준비하고 이전 실패를 보존하세요. macOS/Linux에서는 타임아웃 시 프로세스 그룹을 종료합니다. 이것은 프로세스 정리 기능이며 OS 샌드박스가 아닙니다.

## 사람 검토

`review-template`은 실행·사례·출력 해시를 채우고 나머지는 미완료 상태로 만듭니다. 검토자는 원출력과 원출처를 보고 아래 항목을 작성합니다.

| 항목 | 의미 |
| --- | --- |
| `reviewer_id`, `reviewed_at` | 검토자와 검토 시점 |
| `rationale` | 원문 위치, 판단 이유, 발견한 문제 |
| `evidence_verdict` | 인용의 적합성: pass / fail / pending |
| `answer_verdict` | 답변 전체의 정확성: pass / fail / pending |

빈 검토자·날짜·이유는 유효한 검토로 받아들이지 않습니다. 검토 자체가 아직 없다면 `report`에서 `--reviews`를 생략하세요. 검토가 없는 실행은 자동 통과하지 않습니다.

## 종료 코드

| 명령 | 0 | 1 | 2 |
| --- | --- | --- | --- |
| `run` | 모든 어댑터 실행 정상 종료 | 실행 오류 포함 | 계획·설정 오류 |
| `report` | 보고서 생성 | `--check`에서 하나라도 PASS가 아님 | 입력 오류 |
| 나머지 | 처리 완료 | 사용하지 않음 | 입력·실행 준비 오류 |

일반 `report`의 0은 품질 통과가 아닙니다. `--check`는 모든 조건의 holdout 판정이 PASS일 때만 0을 반환합니다. 입력 파일·계획 검증 단계에서 오류가 발생하면 지정한 보고서에도 INCONCLUSIVE를 기록해 이전 PASS가 최신 결과로 남지 않게 합니다. 잘못된 명령 옵션이나 출력 경로 충돌은 파일을 변경하기 전에 거부합니다.

## 이전 버전에서 옮기기

TypeScript 구현은 harness `graduation-wiki-eval/0.2`, 계획 `graduation-wiki-eval/plan-v2`를 사용합니다. 초기 Python 구현의 v0.1 보고서와 해시는 호환되지 않습니다. 기존 기록을 보존하고, 현재 버전으로 계획을 다시 만든 뒤 실행·검토하세요. 버전 문자열만 바꿔 이전 결과를 합치지 않습니다.
