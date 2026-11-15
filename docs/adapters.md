# 모델 연결

기본 데모는 고정 응답으로 입출력 연결만 확인합니다. 실제 평가에서는 외부 어댑터가 새 세션에서 모델을 실행하고 요청된 JSON을 반환합니다.

## 로컬 실행과 모델 호출

Claude Code는 Anthropic이 제공하는 프로그램이고, 이 레포의 어댑터는 그 프로그램을 명령어로 실행하는 연결 코드입니다.

```text
로컬 또는 CI의 평가 실행기
  → TypeScript 어댑터 → Claude Code CLI → Anthropic의 모델 API
  ← 답변·실행 기록 저장
```

Claude Code의 Read/Grep/Glob 도구로 지정한 자료를 찾아 읽도록 합니다. MCP 서버를 경유하는 방식은 아니며, 현재 어댑터에서는 MCP를 비활성화합니다. API를 직접 호출하는 [OpenAI 어댑터](openai.md)도 사용할 수 있습니다. OpenAI 경로는 허용된 텍스트 전체를 한 요청에 넣으므로, 필요한 파일을 찾아 읽는 Claude Code 경로와 조건이 다릅니다.

로컬 최초 평가는 기존 구독 로그인 또는 API 키로 실행합니다. 현재 수동 CI는 API 키 경로만 사용합니다. 개인의 구독 인증 정보를 CI secret으로 복사하지 않습니다.

## Claude Code 참조 어댑터

`grad-eval-claude`는 Claude Code 2.1.322 이상을 대상으로 하는 TypeScript 어댑터입니다. 구독 로그인 경로는 2.1.325에서 최초 3회와 입력 보완 후 3회의 실제 응답 수집을 확인했습니다. 최초 C의 본문 누락은 [파일럿 기록](experiments/first-subscription-pilot.md)에 정정했고, [재평가 기록](experiments/cs-001-context-rerun.md)에 보완한 자료와 남은 답변 오류를 구분했습니다. API 키 경로는 모의 프로세스로 검사했으며 실제 호출 검증은 아직 하지 않았습니다.

### API 키로 실행

기본값은 `--auth api-key`입니다. `ANTHROPIC_API_KEY`를 실행 환경에 설정해야 합니다. 키는 설정 JSON이나 커밋에 넣지 않습니다. `--bare` 모드는 구독 로그인·키체인을 사용하지 않습니다. [공식 설명](https://code.claude.com/docs/en/headless)

```bash
# 먼저 local/run.json의 모델·제한·runtime을 실제 값으로 맞추고 prepare를 실행합니다.
npm run build
node dist/cli.js run --plan artifacts/baseline/plan.json -- \
  node "$PWD/dist/adapters/claude.js" \
  --model YOUR_PINNED_MODEL_ID --max-budget-usd 0.10 --max-turns 12 --effort medium --timeout 120
```

모델 이름은 사용 가능한 고정 ID로 지정합니다. `sonnet` 같은 이동하는 별칭은 받지 않습니다. 위 금액은 명령 형식의 예시이며 권장 예산이 아닙니다. 제한은 작업당 금액이므로 3사례 × 3조건은 9개 작업입니다. Claude의 비용 제한은 클라이언트 추정치이고 초과될 수 있으므로 실제 총예산에 여유를 두어야 합니다. [비용·턴 제한](https://code.claude.com/docs/en/cli-reference)

API 키 경로는 다음 조건으로 실행합니다.

- 새 설정 디렉터리, 세션 재사용 없음
- `--bare`, `--restricted`, 사용자·프로젝트 설정 자동 로드 제외
- 읽기 도구 Read/Grep/Glob만 허용, MCP와 브라우저 비활성화
- 지정한 모델·effort·턴·비용 제한 사용
- 성공한 `structured_output`만 수용. 오류·거절·일반 텍스트를 정답 JSON으로 추정해 복구하지 않음

### 구독 로그인으로 로컬에서 실행

Claude Code에 Pro·Max·Ultra 계정으로 로그인되어 있다면 API 키 없이 실행할 수 있습니다. 로그인되지 않았다면 터미널에서 `claude auth login`을 실행하고 구독 계정을 선택합니다. 어댑터는 `claude auth status --json`으로 인증 방식과 구독을 확인합니다. 계정 식별 정보는 모델에게 보내거나 평가 결과에 남기지 않습니다.

**구독 한도만 사용하려면 먼저 [Claude 사용량 설정](https://claude.ai/settings/usage)의 추가 사용량(usage credits/extra usage)을 꺼야 합니다.** `--usage-credits-disabled`는 이를 확인했다는 실행자의 표시입니다. 어댑터가 계정의 과금 설정을 조회하거나 변경했다는 뜻은 아닙니다. 구독 로그인만으로 추가 과금이 차단되는 것은 아닙니다. [공식 비용 안내](https://code.claude.com/docs/en/costs)

```bash
# local/run.json의 model_config에 인증 방식·제한, runtime에 CLI 버전을 기록한 뒤 prepare합니다.
node dist/cli.js run --plan artifacts/subscription-pilot-01/plan.json -- \
  node "$PWD/dist/adapters/claude.js" \
  --auth subscription --usage-credits-disabled \
  --model YOUR_PINNED_MODEL_ID --max-turns 12 --effort medium --timeout 120
```

실행 설정에는 별도 `auth` 필드가 없으므로 `model_config` 문자열에 인증 방식과 제한을 함께 적습니다. 같은 비교 실험에서는 이 값을 고정합니다.

구독 모드는 로그인용 설정 디렉터리를 유지하면서 `--safe-mode`로 개인 CLAUDE.md·Skill·플러그인·메모리 자동 로드를 끕니다. `--restricted`와 Read/Grep/Glob 제한, MCP·브라우저 비활성화, 새 세션 실행은 동일하게 적용합니다. Fast mode도 끕니다. 관리자 정책은 여전히 적용될 수 있으므로 이 설정을 OS 수준의 격리로 설명하지 않습니다. [CLI 옵션](https://code.claude.com/docs/en/cli-reference)

API 키·인증 토큰·외부 제공자 설정이 환경에 있으면 구독 모드는 호출 전에 중단합니다. 로그인 실패나 한도 초과를 API 인증으로 우회하지 않습니다. 작업당 턴·시간 제한을 쓰며, 선택적으로 지정한 `--max-budget-usd`는 CLI의 사용량 추정치 제한입니다. 구독의 청구액이나 전체 구독 한도를 뜻하지 않습니다.

npm 패키지로 설치한 경우 `grad-eval`과 `grad-eval-claude` 명령을 사용할 수 있습니다. 직접 스크립트 경로를 넘길 때는 위 예시처럼 절대 경로를 사용합니다. 실행기는 작업마다 현재 디렉터리를 바꿉니다.

런너의 timeout은 어댑터 timeout보다 길게 잡습니다. 예를 들어 어댑터 120초라면 실행 설정에는 150초를 둘 수 있습니다. 바깥 실행기가 먼저 제한에 도달하더라도 종료 신호를 Claude 자식 프로세스 그룹까지 전달하고, 정리되지 않으면 짧은 유예 뒤 강제 종료합니다. 어댑터 오류는 실행 실패로 기록하며 런너가 자동 재시도하지 않습니다. Claude 내부 API 재시도는 CLI의 동작이므로 별개입니다.

## C 조건에서 평가하는 범위

이 어댑터는 네이티브 Skill과 슬래시 명령을 비활성화하고, C의 Skill 파일 목록을 명시적으로 제공합니다. 모델이 어떤 문서를 읽을지 판단할 수 있지만, 결과는 **Skill 문서 제공의 효과**로 해석합니다. 네이티브 Skill 자동 탐색·라우팅의 성능으로 보고하지 않습니다.

`SKILL.md`가 다른 파일을 가리키는 wrapper라면 실제 절차 본문까지 명시적으로 제공해야 합니다. 실제 C 실행에는 `skill_contract`로 진입점과 필수 참조를 선언합니다. `prepare`와 `run`은 제공된 파일의 독립된 `@...` 가져오기 참조와 선언한 필수 파일을 검사하고, 누락·빈 본문·순환 참조를 모델 호출 전에 차단합니다. 참조를 찾아 디스크에서 자동 복사하거나 네이티브 Skill로 등록하는 기능은 아닙니다. 경로 형식과 검사 범위는 [입력과 실행 기록](data-format.md#c-조건의-skill-본문과-참조)에 설명했습니다.

네이티브 Skill 라우팅을 평가하려면 별도 어댑터에서 제공된 Skill만 등록하고 A/B에는 자동 로드되지 않는지 추가 검증해야 합니다. 파일 목록을 넘겼다는 사실만으로 자동 선택을 검증했다고 쓰지 않습니다.

### 실제 파일 읽기 기록

Claude 어댑터에 `--trace-tools`를 붙이면 답변 JSON과 별도로 작업 디렉터리의 `claude-tools.json`에 도구 기록을 남깁니다. 기존 답변·채점 형식은 유지합니다.

```sh
node dist/cli.js run --plan artifacts/your-experiment/plan.json -- \
  node "$PWD/dist/adapters/claude.js" --auth subscription --usage-credits-disabled \
  --trace-tools --model YOUR_PINNED_MODEL_ID --max-turns 12 --effort medium --timeout 180
```

기록은 [공식 CLI의 `stream-json`·`--verbose` 옵션](https://code.claude.com/docs/en/cli-reference)과 [SDK 메시지·도구 출력 구조](https://code.claude.com/docs/en/agent-sdk/typescript)를 사용합니다. 모델에게 읽었다고 자체 보고하도록 요청하는 방식은 아닙니다.

| 기록 | 의미 |
| --- | --- |
| `calls` | 도구 요청과 연결된 결과. 순서, 도구, 허용 목록 내 경로, 성공·실패·미완료를 구분 |
| `requested`, `delivered_lines` | 요청한 줄·페이지 범위와 텍스트 도구가 실제 반환한 줄 범위 |
| `matched_files` | Grep·Glob 검색 결과에 포함된 허용 파일. 본문 읽기와 구분 |
| `read_files` | 성공한 Read 결과에 인식 가능한 파일 전달 정보가 있는 파일 |
| `fully_read_files` | 같은 전체 줄 수를 가진 텍스트 Read 결과가 첫 줄부터 끝까지 빈틈없이 덮은 파일 |
| `required_skill_files`, `unread_skill_files` | 전체 읽기를 요구한 Skill 파일과 이를 충족하지 못한 파일 |
| `complete`, `issues`, `outcome` | 기록의 완결성, 형식·연결 문제, 답변 반환 여부. 평가 품질 PASS와는 별개 |
| `request_sha256`, `output_sha256` | 요청·최종 응답과의 결합 정보 |

한 번 Read했다고 파일 전체를 읽었거나 지침을 이해했다고 판단하지 않습니다. 일부 줄만 반환될 수 있습니다. 실패·미완료·캐시 응답·해석하지 못한 반환 형식은 새 본문 전달로 집계하지 않습니다. `read_files`는 Read 도구에 한정되며, Grep에서 일부 내용을 확인한 행위는 별도로 해석해야 합니다.

원시 스트림의 원문 내용, 사고 과정, 인증 정보, 검색어, 임의의 컴퓨터 경로는 기록에 복사하지 않습니다. 기록 파일을 새로 만들 수 없으면 모델 호출을 시작하지 않습니다. 타임아웃·출력 제한 때는 확보한 불완전 기록을 남기고, 스트림이 끊기거나 프로세스가 강제 종료돼 기록이 비어 있다면 파일을 읽지 않았다는 증거로 사용하지 않습니다. 이는 CLI가 보고한 도구 이력이며 OS 수준의 파일 접근 감사는 아닙니다.

`--trace-tools --require-skill-reads`를 함께 사용하면 모델에게 `context.skills`의 모든 파일을 Read로 읽도록 지시하고, 답변을 반환하기 전에 전체 텍스트 읽기 범위가 확인되는지 검사합니다. 파일 목록 제공만으로 C의 Skill 사용을 가정하지 않기 위한 옵션입니다. 누락·부분 읽기·확인 불가능한 반환 형식이면 정상 응답으로 처리하지 않고 실행 오류와 기록을 남깁니다. 원래 답변이 맞는지와는 별도의 실행 조건 검사입니다. 추가 지시가 모델 프롬프트에 들어가므로 이 옵션을 바꾼 실험은 같은 실행 조건이라고 보고하지 않습니다.

[실제 C 평가](experiments/cs-001-skill-verification.md)에서 기록 기능과 읽기 검사를 확인했습니다. 기존 C는 Skill을 읽지 않았고, 읽기를 요구한 C는 관련 파일 4개를 모두 읽었습니다. 후자의 수치는 정답과 일치했지만 원문 대조 절차는 이행하지 않아, 읽기 성공만으로 품질 통과를 표시하지 않았습니다.

## 접근 범위

Claude의 restricted 설정은 파일 도구를 작업 디렉터리로 제한하는 애플리케이션 제어입니다. 관리자 설정은 여전히 영향을 줄 수 있습니다. 일반 외부 어댑터 실행기는 OS 샌드박스를 만들지 않으며 환경 변수를 상속합니다. 실측 전 정답·이전 결과·운영 DB에 대한 접근을 제한한 실행 환경을 준비해야 합니다.

실제 사용한 CLI·어댑터 버전과 관리 설정을 기록하세요. 모델·프롬프트·제한을 바꾼 실행을 WIKI 변경만의 효과로 비교하지 않습니다.
