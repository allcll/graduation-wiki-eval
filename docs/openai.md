# OpenAI API로 평가하기

`grad-eval-openai`는 Claude Code를 실행하지 않고 OpenAI Responses API를 직접 호출합니다. 실행 장소는 로컬이지만 답변은 OpenAI 서버에서 생성되며 토큰 사용량에 따라 비용이 발생합니다. ChatGPT 로그인 정보를 읽지 않습니다.

## 무엇이 달라지는가

| 항목 | Claude Code 어댑터 | OpenAI 어댑터 |
| --- | --- | --- |
| 자료 전달 | 파일 목록을 넘기고 모델이 Read/Grep/Glob으로 탐색 | 해당 조건에 허용된 텍스트 파일 내용을 한 요청에 담음 |
| 실행 | Claude Code CLI | HTTPS Responses API |
| 인증 | `ANTHROPIC_API_KEY` | `OPENAI_API_KEY` |
| 제한 | CLI의 턴·비용·시간 제한 | 입력 바이트·출력 토큰·시간 제한 |
| 재시도 | 실행기는 재시도하지 않음. CLI 내부 동작은 별도 | 자동 재시도 없음. 작업당 요청 한 번 |

OpenAI 안에서도 A는 원본, B는 원본+WIKI, C는 원본+WIKI+Skill 문서를 받습니다. 세 조건에 같은 모델·지시·출력 계약·제한을 씁니다. 정답·채점 기준·검토 의견은 보내지 않습니다.

Claude와 OpenAI는 모델뿐 아니라 자료 탐색 방식도 다릅니다. 두 실행의 차이를 WIKI 수정만의 효과로 비교하지 않습니다. 네이티브 Skill 자동 선택이나 코드 수정 성능을 평가하는 경로도 아닙니다.

## 준비와 실행

1. 실행할 쉘의 환경 변수에 `OPENAI_API_KEY`를 설정합니다. 키를 실행 설정이나 Git에 넣지 않습니다. 이 프로그램은 `.env`를 자동으로 읽지 않습니다.
2. 원문·WIKI·Skill을 별도의 텍스트 컨텍스트 디렉토리에 준비합니다. 현재 UTF-8 `md`, `txt`, `json`, `jsonl`, `csv`, `tsv`, `yaml`, `yml` 파일을 받습니다. PDF를 직접 전송하지 않습니다. PDF를 텍스트로 추출했다면 표·각주가 보존됐는지 확인하고 원본 해시·페이지·추출 방법을 기록해야 합니다. 검토용 정답 폴더를 컨텍스트로 사용하지 않습니다.
3. [최초 평가 가이드](first-evaluation.md)의 실행 설정에서 `model`을 사용할 ID, `tools`를 `none-inline-text`, `runtime`을 `openai-responses-v1`로 설정합니다. `execution`은 실제 호출이면 `real`, 실행기 timeout은 예를 들어 150초로 둡니다. 기존 계획을 수정하지 않고 `prepare`로 새 계획을 만듭니다.
4. 아래 명령을 실행합니다. 모델은 계정에서 사용할 수 있는 ID를 명시합니다. 평가 간 재현성이 필요하면 제공되는 고정 버전 ID를 사용합니다.

```sh
npm run build
node dist/cli.js prepare --cases local/pilot.cases.jsonl \
  --config local/openai-run.json --out artifacts/openai-pilot-01

node dist/cli.js run --plan artifacts/openai-pilot-01/plan.json -- \
  node "$PWD/dist/adapters/openai.js" \
  --model YOUR_MODEL_ID --max-output-tokens 4096 \
  --max-input-bytes 262144 --timeout 120
```

입력 제한에는 파일 내용과 요청 지시·JSON 형식이 포함됩니다. 넘치면 호출 전에 실패하며 자료를 조용히 잘라내지 않습니다. 모델의 context window 제한도 별도로 적용됩니다. 출력 제한은 추론 토큰을 포함하므로 너무 작게 잡으면 최종 답변이 나오기 전에 종료될 수 있습니다.

각 작업의 `stdout.txt`에는 답변과 provider 응답 ID·사용량이 남습니다. `runs.jsonl`에는 채점용 답변과 실제 반환된 모델 ID, 실행 설정 해시, 입출력 토큰 수를 기록합니다. 응답 ID는 실행마다 다르므로 비교용 버전에는 포함하지 않습니다. 오류·거절·출력 중단·잘못된 JSON은 성공 답변으로 복구하지 않습니다.

다음 단계인 `review-template → 사람 검토 → report`는 기존과 같습니다. 토큰 사용량은 성공 응답에서 확보한 값이며, 실패·시간 초과 요청에도 비용이 발생할 수 있어 청구 합계와 같다고 보장하지 않습니다. 실제 청구는 API 계정에서 확인합니다.

## 비용을 확인하는 순서

먼저 3건 × A/B/C = 9작업으로 연결과 응답을 확인합니다. 112건 전체는 336작업입니다. 첫 실행의 실제 토큰 수와 사람이 확인한 답변 품질을 보고 모델·평가 범위를 정합니다.

2026-11-15 확인한 [공식 요금표](https://developers.openai.com/api/docs/pricing)의 Standard·Short 구간에서 `gpt-6-luna`는 100만 입력 토큰당 $0.10, 출력 토큰당 $0.50입니다. 이는 저비용 후보의 가격이며 이 프로젝트에서 품질이나 계정 접근성을 검증한 결과는 아닙니다. 공급자 이름만으로 비용을 판단하지 말고 사용할 모델·요금 구간을 확인합니다.

예를 들어 작업당 입력 20,000·출력 2,000토큰이라고 **가정**하면 이 단가에서 9작업은 약 $0.027, 336작업은 약 $1.008입니다. 실제 자료 길이·추론 토큰·요금 구간·실패 호출에 따라 달라집니다. 현재 입력·출력 제한은 달러 예산 상한을 보장하지 않습니다.

이 어댑터는 공식 엔드포인트에 `store: false`, 도구 없음, 자동 잘라내기 없음으로 요청합니다. `store: false`는 응답 저장 옵션이며 모든 보관 정책의 면제를 의미하지 않습니다. 출력 형식의 `facts_json`은 가변 키를 가진 정답 값 객체를 운반하는 문자열입니다. 로컬에서 JSON 객체로 검증·변환한 뒤 기존 채점기의 `facts` 계약을 유지합니다.

현재 모의 HTTP 응답으로 요청·실패 처리·사용량 기록을 검증했으며, 실제 API 키를 사용한 유료 호출은 아직 하지 않았습니다. 기존 수동 CI workflow의 실제 모델 경로는 Claude 전용이므로 OpenAI CI 연결은 별도 작업입니다.

참고: [Responses API](https://developers.openai.com/api/reference/resources/responses/methods/create), [Structured Outputs](https://developers.openai.com/api/docs/guides/structured-outputs).
