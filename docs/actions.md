# 공통 명령으로 평가 실행하기

여러 CLI 명령을 순서대로 호출하고, 검토용 기록과 공개할 숫자 요약을 나누는 실행 스크립트입니다. 로컬과 CI에서 같은 명령을 사용할 수 있습니다. GitHub workflow 연결은 후속 PR에서 추가합니다.

## 로컬에서 CI와 같은 흐름 실행하기

```bash
npm ci
npm run build
node scripts/evaluate-ci.mjs --mode sample --out artifacts/ci-sample-001
```

명령은 기존 CLI의 `prepare → run → review-template → report`를 순서대로 호출합니다. 출력 디렉터리는 매번 새 경로를 지정합니다.

```text
artifacts/ci-sample-001/
├── public/
│   ├── public-summary.json   숫자와 정해진 상태값만 포함
│   └── public-summary.md
└── raw/
    ├── cases.jsonl          평가자용 정답 포함
    ├── runner-config.json
    ├── experiment/          조건별 자료, 답변, 오류, 실행 기록
    ├── reviews.jsonl        사람이 채우는 검토 양식
    ├── reviews.md           질문·정답·원답변·판정 기준
    └── report.json / report.md
```

각 명령의 stdout/stderr도 `raw/`에 저장합니다. 오류 메시지에 문의나 답변이 포함될 수 있으므로 CI 로그에는 그대로 출력하지 않습니다. 공개 요약을 만들 때는 `validateReport`로 보고서를 검증하고, 허용한 숫자와 상태값만 새 객체로 옮깁니다. 질문·답변·사례 ID·근거·리뷰 설명은 요약에 포함하지 않습니다.

표의 수치는 dev와 holdout의 합계이고, 품질 판정은 holdout에만 적용됩니다. 필수 조건 실패 실행 수와 BLOCKER/MAJOR/MINOR 항목 수는 서로 다른 단위입니다.

## 실제 모델을 로컬에서 실행하기

입력 형식은 [입력 데이터](data-format.md), 정답 준비는 [첫 평가](first-evaluation.md)를 따릅니다. 사례와 설정 경로는 `--data-root` 아래의 상대 경로이며, 설정의 `context_root`도 같은 데이터 디렉터리 안에 있어야 합니다. 심볼릭 링크로 외부 파일을 가리키는 입력은 거부합니다.

```bash
# API 키는 실행 환경에 설정합니다. 명령·JSON·커밋에 키를 적지 않습니다.
node scripts/evaluate-ci.mjs --mode claude --data-root /path/to/private-wiki \
  --cases eval/cases.jsonl --config eval/run.json \
  --model YOUR_PINNED_MODEL_ID --claude-version 2.1.322 \
  --max-budget-usd 0.10 --max-turns 12 --effort medium --timeout 120 \
  --out artifacts/actual-001
```

모델 ID와 CLI 버전은 사용할 수 있는 고정 값으로 지정합니다. 위 금액은 명령 형식의 예시이며 권장 예산이 아닙니다. 예산은 작업당 제한이고, 사례 × 조건 × 반복 횟수만큼 모델을 호출합니다. 이 CI 진입점은 한 번에 최대 50개 작업을 허용합니다. CLI의 비용 제한은 추정치이므로 정확한 전체 지출 상한을 보장하지 않습니다.

실행기는 설정 JSON에 적힌 모델·도구·runtime 라벨 대신 실제 명령의 모델, CLI 버전, effort, 턴·시간·비용 제한으로 실행 메타데이터를 고정합니다. 원문·WIKI·Skill 파일과 정답셋은 기존 `prepare` 절차로 기록합니다. 외부 어댑터 경로나 임의 셸 명령은 받지 않습니다.

완료 후 `raw/reviews.md`와 원문을 확인하여 `raw/reviews.jsonl`을 채우고, 기존 `report --reviews ...` 명령으로 다시 채점합니다. 처음 자동 실행한 보고서에는 사람 검토가 없으므로 이를 승인된 평가 결과로 사용하지 않습니다.

현재 OS 샌드박스는 제공하지 않습니다. 실제 모델 평가 전에는 정답·이전 결과·운영 자격 증명의 접근 범위를 제한하고 확인해야 합니다. 실제 ALLCLL 정답셋과 모델을 사용한 검증은 아직 진행 전입니다.
