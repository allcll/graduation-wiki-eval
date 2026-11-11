# 모델 연결

기본 데모는 고정 응답으로 입출력 연결만 확인합니다. 실제 평가에서는 외부 어댑터가 새 세션에서 모델을 실행하고 요청된 JSON을 반환합니다.

## Claude Code 참조 어댑터

이 레포의 어댑터는 Claude Code 2.1.322 이상을 대상으로 합니다. 해당 CLI의 옵션과 반환 형식을 확인하고 모의 프로세스로 검사했습니다. 실제 API를 호출한 통합 검증은 아직 하지 않았습니다.

`ANTHROPIC_API_KEY`를 실행 환경에 설정해야 합니다. 키는 설정 JSON이나 커밋에 넣지 않습니다. `--bare` 모드는 구독 로그인·키체인을 사용하지 않습니다. [공식 설명](https://code.claude.com/docs/en/headless)

```bash
# 먼저 local/run.json의 모델·제한·runtime을 실제 값으로 맞추고 prepare를 실행합니다.
grad-eval run --plan artifacts/baseline/plan.json -- \
  python -m graduation_wiki_eval.adapters.claude_cli \
  --model YOUR_PINNED_MODEL_ID --max-budget-usd 0.10 --max-turns 12 --effort medium --timeout 120
```

모델 이름은 사용 가능한 고정 ID로 지정합니다. `sonnet` 같은 이동하는 별칭은 받지 않습니다. 위 금액은 명령 형식의 예시이며 권장 예산이 아닙니다. 제한은 작업당 금액이므로 3사례 × 3조건은 9개 작업입니다. Claude의 비용 제한은 클라이언트 추정치이고 초과될 수 있으므로 실제 총예산에 여유를 두어야 합니다. [비용·턴 제한](https://code.claude.com/docs/en/cli-reference)

어댑터는 다음 조건으로 실행합니다.

- 새 설정 디렉터리, 세션 재사용 없음
- `--bare`, `--restricted`, 사용자·프로젝트 설정 자동 로드 제외
- 읽기 도구 Read/Grep/Glob만 허용, MCP와 브라우저 비활성화
- 지정한 모델·effort·턴·비용 제한 사용
- 성공한 `structured_output`만 수용. 오류·거절·일반 텍스트를 정답 JSON으로 추정해 복구하지 않음

런너의 timeout은 어댑터 timeout보다 길게 잡습니다. 예를 들어 어댑터 120초라면 실행 설정에는 150초를 둘 수 있습니다. 어댑터 오류는 실행 실패로 기록하며 런너가 자동 재시도하지 않습니다. Claude 내부 API 재시도는 CLI의 동작이므로 별개입니다.

## C 조건에서 평가하는 범위

이 어댑터는 네이티브 Skill과 슬래시 명령을 비활성화하고, C의 Skill 파일 목록을 명시적으로 제공합니다. 모델이 어떤 문서를 읽을지 판단할 수 있지만, 결과는 **Skill 문서 제공의 효과**로 해석합니다. 네이티브 Skill 자동 탐색·라우팅의 성능으로 보고하지 않습니다.

네이티브 Skill 라우팅을 평가하려면 별도 어댑터에서 제공된 Skill만 등록하고 A/B에는 자동 로드되지 않는지 추가 검증해야 합니다. 파일 목록을 넘겼다는 사실만으로 자동 선택을 검증했다고 쓰지 않습니다.

## 접근 범위

Claude의 restricted 설정은 파일 도구를 작업 디렉터리로 제한하는 애플리케이션 제어입니다. 관리자 설정은 여전히 영향을 줄 수 있습니다. 일반 외부 어댑터 실행기는 OS 샌드박스를 만들지 않으며 환경 변수를 상속합니다. 실측 전 정답·이전 결과·운영 DB에 대한 접근을 제한한 실행 환경을 준비해야 합니다.

실제 사용한 CLI·어댑터 버전과 관리 설정을 기록하세요. 모델·프롬프트·제한을 바꾼 실행을 WIKI 변경만의 효과로 비교하지 않습니다.
