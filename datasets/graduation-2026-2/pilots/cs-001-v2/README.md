# CS-001 학점 정의 재평가

`v1`의 `CS-2026-2-001`을 다시 실행하기 위한 개발용 문항입니다. 112건 릴리스는 수정하지 않았습니다.

기존 `recognized_credits` 설명은 ‘이수 과목 중 인정 학점’이었습니다. 충족에 필요한 최소 기준과 혼동할 수 있어, 이번 입력에서는 ‘해당 요건에 포함되는 이수 과목들의 취득 학점 합계’로 정의합니다. `required_credits`는 ‘충족에 필요한 최소 학점’으로 구분합니다. 출력 설명에 정답 숫자를 추가하지 않았습니다.

질문 본문, 학생 조건, 정답값, 편람 근거, 채점 기준은 동일합니다. 변경 내역과 부모 문항 해시는 `provenance.json`에 기록했습니다. 입력 정의가 달라졌으므로 기존 승인 기록을 복사하지 않고 `draft`로 둡니다. 자동 값 검사는 가능하지만 독립적인 사람 검토를 마친 정답셋으로 취급하지 않습니다.

```sh
node dist/cli.js validate --cases datasets/graduation-2026-2/pilots/cs-001-v2/cases.jsonl
```

이 폴더는 평가자용입니다. 모델 컨텍스트에 넣지 않습니다. WIKI를 그대로 둔 채 C의 실제 Skill 본문과 필수 참조를 준비해 재평가합니다. 입력과 C 자료 구성이 함께 바뀌므로 이전 실행과의 차이를 WIKI 개선이나 Skill 단독 효과로 보고하지 않습니다.

## 실행 자료 준비

`run.example.json`은 이번 재평가 설정입니다. 레포 루트에서 `local/cs-001-context-rerun-2026-11-15/context/`에 다음 파일을 준비합니다. 기존 첫 실행과 비교할 때는 추출 텍스트를 새로 만들지 않고 첫 실행의 원문·WIKI 파일을 그대로 복사해 해시가 같은지 확인합니다.

| 상대 경로 | 준비할 자료 |
| --- | --- |
| `original/handbook-2026-2.pdf`, `.txt` | 고정한 2026-2 편람과 검색용 추출 텍스트 |
| `wiki/INDEX.md`, `wiki/cohort/2022/balance.md` | 첫 실행과 같은 WIKI 파일 |
| `skill-bundle/.claude/skills/grad-wiki-query/SKILL.md` | Skill wrapper |
| `skill-bundle/docs/agent-harness/skills/grad-wiki-query/SKILL.md` | wrapper가 참조하는 본문 |
| `skill-bundle/CLAUDE.md`, `skill-bundle/docs/agent-harness/PROJECT.md` | 본문이 참조하는 표 추출 지침과 공통 규칙 |

WIKI·Skill은 `allcll/allcll-graduation-wiki`의 `b7d05fcae2c8f588b2ed18e0fa4bc4f87d23512a`에서 읽습니다. 이 자료는 별도 접근 권한이 필요하며 공개 평가셋에 포함하지 않습니다. 파일 전체를 자동 검색하거나 CS 기록을 복사하지 않습니다. 모델 요청에는 정답·채점 기준·이전 응답을 넣지 않습니다.

```sh
node dist/cli.js prepare \
  --cases datasets/graduation-2026-2/pilots/cs-001-v2/cases.jsonl \
  --config datasets/graduation-2026-2/pilots/cs-001-v2/run.example.json \
  --out artifacts/cs-001-context-rerun-new

node dist/cli.js run --plan artifacts/cs-001-context-rerun-new/plan.json -- \
  node "$PWD/dist/adapters/claude.js" --auth subscription --usage-credits-disabled \
  --model claude-sonnet-4-6 --max-turns 12 --effort medium --timeout 180
```

구독 실행 전 준비는 [구독 로그인 가이드](../../../../docs/adapters.md#구독-로그인으로-로컬에서-실행)를 따릅니다. `run`부터 실제 모델이 호출됩니다. 실행기 timeout은 210초이며 조건별 1회, 총 3회입니다. 예제의 모델·CLI·Node 버전은 이 실험 당시 값이므로 다른 환경에서 사용할 때는 실제 값으로 변경하고 새 실행으로 기록합니다.

Read/Grep/Glob만 허용하므로 Skill 본문에 있는 pdfplumber 실행은 지원하지 않습니다. 이번 범위는 문서를 제공한 답변 평가이며 네이티브 Skill 자동 선택이나 전체 절차 수행을 평가한 것이 아닙니다.
