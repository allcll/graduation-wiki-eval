# 2026-2 졸업요건 평가셋 v1.0.0

학번·학과·이수 시점에 따라 달라지는 졸업요건을 모델이 정확히 적용하는지 확인하기 위한 112개 문항입니다. 질문, 입력 조건, 기대 행동, 정답값, 편람 근거, 문항별 채점 기준과 승인 기록을 함께 관리합니다.

## 사례 구성

| 구분 | 건수 | 구성 방식 |
| --- | --- | --- |
| CS 재구성 | 20 | 기존 문의에서 평가할 문제 유형과 필요한 조건을 추려 작성 |
| 운영 점검 재구성 | 5 | 기준 데이터와 편람의 불일치에서 작성 |
| 편람 기반 가상 사례 | 87 | 예외·경계·복합 조건을 조합해 작성 |

전부 개발용(`dev`)이며 독립적인 최종 성능 측정용 holdout은 아닙니다. 112건이라는 수가 모든 규정 조합의 커버리지를 의미하지 않습니다. 현재 실제 모델 평가 결과는 없습니다.

예를 들어 `CS-2026-2-001`은 영역 수와 학점을 구분하는지, `BALX-2026-2-015`는 서로 다른 입학 연도 정보가 주어졌을 때 확인을 요청하는지, `EXP-MA-2026-2-009`는 편람만으로 확정할 수 없는 행정 기준을 임의로 판단하지 않는지를 확인합니다.

## 파일과 이력

| 파일 | 내용 |
| --- | --- |
| [cases.jsonl](cases.jsonl) | 승인된 평가 문항·정답·채점 기준 |
| [drafts.jsonl](drafts.jsonl) | 승인 전 초안 |
| [review.workspace.json](review.workspace.json) | 문항별 검토자·의견·승인 해시 |
| [source-links.json](source-links.json) | 편람 PDF 상대 경로와 82개 근거 위치 |
| [manifest.json](manifest.json) | 버전, 파일 해시, 파일럿 문항 3건의 ID |
| `provenance-*.json` | 67건 → 82건 → 112건의 작성·선정 이력 |
| [approval-record.json](approval-record.json) | 정답 초안 채택 승인 범위 |
| [source-verification.json](source-verification.json) | 공식 배포 파일과 원본 해시 일치 확인 |

초안은 AI(Codex)가 작성했고, 안금서의 승인은 현재 초안을 평가용 정답으로 채택한 결정입니다. `verified`는 도구의 승인 절차를 통과한 상태이며 독립적인 원문 대조를 수행했다는 증빙은 아닙니다. 모델 응답의 사람 채점도 별도 단계입니다.

공개본에는 재구성한 문항을 넣고, CS 원문·학생 식별자·비공개 기록의 URL과 행 번호·운영 DB 자료는 넣지 않았습니다. 작성·승인 이력은 유지했으며, 공개 위치 변경으로 질문·정답·채점 기준·검토 의견을 바꾸지는 않았습니다. 이 구성은 공개된 개발용 평가셋이므로 모델 입력과 검색 범위에서 정답을 분리해야 합니다.

## 편람 준비

원본 PDF를 이 레포에 재배포하지 않고 [세종대학교 공식 안내](https://www.sejong.ac.kr/kor/intro/notice3.do?articleNo=891086&mode=view)의 첨부파일을 사용합니다. 2026-11-15에 공식 파일을 내려받아 기존 평가셋이 사용한 PDF와 SHA-256이 같음을 확인했습니다. 생성 당시 provenance의 미확인 메모는 이 후속 확인 기록과 함께 읽습니다.

평가 도구 레포 루트에서 실행합니다.

```sh
npm ci
npm run build

# PDF 없이 문항·검토 기록·출처 연결 정의를 검사합니다.
node dist/cli.js dataset-check --root . \
  --manifest datasets/graduation-2026-2/v1/manifest.json --metadata-only

# 공식 배포처에서 원본을 준비합니다. 내려받은 PDF는 Git에서 제외됩니다.
mkdir -p datasets/graduation-2026-2/v1/sources
curl --fail --location --max-time 60 \
  'https://www.sejong.ac.kr/kor/intro/notice3.do?articleNo=891086&attachNo=236782&mode=download' \
  --output datasets/graduation-2026-2/v1/sources/handbook-2026-2.pdf

# PDF 판본까지 검사한 뒤 이동 가능한 검토 폴더를 만듭니다.
node dist/cli.js dataset-check --root . \
  --manifest datasets/graduation-2026-2/v1/manifest.json
node dist/cli.js dataset-review --root . \
  --manifest datasets/graduation-2026-2/v1/manifest.json --out local/team-review-v1
```

`--metadata-only`는 `source_assets_verified: false`를 반환합니다. 편람 내용이나 정답의 정확성까지 검사했다는 뜻이 아닙니다. 전체 검증과 검토 화면 생성은 원본 PDF가 없거나 해시가 다르면 실패합니다. 공식 첨부파일이 변경됐다고 기존 manifest의 해시만 바꾸지 말고 새 판본의 영향을 검토합니다.

생성된 `review.html`, `review.workspace.json`, `sources/`를 포함한 폴더 전체를 옮기면 다른 컴퓨터에서도 PDF 페이지 링크를 열고 검토를 이어갈 수 있습니다. 파일럿은 `pilot.cases.jsonl`의 3건 × A/B/C로 시작합니다. 실제 모델 실행에는 정답지와 분리된 원문·WIKI·Skill 및 실행 설정이 추가로 필요합니다.

## 변경 원칙

사용한 릴리스는 보존하고 수정 시 다음 버전 디렉토리를 추가합니다. 질문·정답·근거·기준이 바뀌면 다시 검토하고 내보낸 뒤 파일 해시를 갱신합니다. PR에는 바뀐 문항과 이유를 적습니다. 평가 기록에는 도구 커밋 SHA, 데이터셋 해시, 모델과 입력 자료 버전을 함께 남깁니다.
