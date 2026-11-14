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

`grad-eval-claude`는 Claude Code 2.1.322 이상을 대상으로 하는 TypeScript 어댑터입니다. 구독 로그인 경로는 2.1.325에서 1사례 × A/B/C 실제 실행을 확인했습니다. [파일럿 기록](experiments/first-subscription-pilot.md)에 범위와 결과를 남겼습니다. API 키 경로는 모의 프로세스로 검사했으며 실제 호출 검증은 아직 하지 않았습니다.

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

네이티브 Skill 라우팅을 평가하려면 별도 어댑터에서 제공된 Skill만 등록하고 A/B에는 자동 로드되지 않는지 추가 검증해야 합니다. 파일 목록을 넘겼다는 사실만으로 자동 선택을 검증했다고 쓰지 않습니다.

## 접근 범위

Claude의 restricted 설정은 파일 도구를 작업 디렉터리로 제한하는 애플리케이션 제어입니다. 관리자 설정은 여전히 영향을 줄 수 있습니다. 일반 외부 어댑터 실행기는 OS 샌드박스를 만들지 않으며 환경 변수를 상속합니다. 실측 전 정답·이전 결과·운영 DB에 대한 접근을 제한한 실행 환경을 준비해야 합니다.

실제 사용한 CLI·어댑터 버전과 관리 설정을 기록하세요. 모델·프롬프트·제한을 바꾼 실행을 WIKI 변경만의 효과로 비교하지 않습니다.
