# graduation-wiki-eval

졸업요건 WIKI와 Skill을 바꾼 뒤, 답변이 실제로 나아졌는지 확인하는 평가 도구입니다.

학점 숫자가 맞아도 다른 학번의 규정을 인용했다면 올바른 답변이 아닙니다. 필요한 정보가 없는 질문에는 추가 질문을 해야 하고, 규정이 충돌하면 판단을 보류해야 합니다. 이런 차이를 사례별로 기록하고, 변경 전후에 새로 생긴 오류를 찾습니다.

## 무엇을 비교하나

| 조건 | 제공하는 자료 |
| --- | --- |
| A | 원본 편람·확인 자료와 과제에 필요한 코드·데이터 |
| B | A + WIKI |
| C | B + Skill 문서 |

모델·도구·출력 형식·실행 제한은 동일하게 둡니다. 정답은 WIKI에서 복사하지 않고 원출처를 확인해 작성합니다. 기존 ALLCLL WIKI는 평가 대상이며, 이 레포는 평가 도구와 검증 절차를 다룹니다.

## 빠르게 실행하기

Python 3.11 이상이 필요합니다. 외부 명령 실행은 macOS/Linux를 지원합니다. 런타임 의존 패키지는 없습니다.

```bash
git clone https://github.com/allcll/graduation-wiki-eval.git
cd graduation-wiki-eval
python3 -m venv .venv
source .venv/bin/activate
python -m pip install -e .

grad-eval demo --out artifacts/demo
```

데모는 가상 규정 3개를 A/B/C에서 실행합니다. 고정 응답을 반환하는 예제 어댑터를 쓰므로 **모델 호출이나 API 비용이 발생하지 않습니다.**

결과는 `artifacts/demo/report.md`와 `report.json`에 저장됩니다. 계획한 실행은 9개, 자동 검사 통과는 9개, 사람 검토 대기는 9개입니다. 합성 자료이므로 품질 판정은 모두 `INCONCLUSIVE`가 정상입니다. 이 숫자는 실제 WIKI의 성능이 아닙니다. 다시 실행할 때는 새 출력 경로를 사용하세요.

## 내 자료로 평가하기

1. 원출처를 검토해 사례·정답·근거를 작성합니다.
2. 조건별로 제공할 파일과 모델 설정을 정하고 실행 계획을 고정합니다.
3. 어댑터를 실행해 원출력·오류·소요 시간을 저장합니다.
4. 사실·행동을 자동 검사하고 근거와 답변 전체를 사람이 검토합니다.
5. WIKI·Skill을 개선한 뒤 같은 조건으로 다시 실행해 회귀를 확인합니다.

```bash
grad-eval validate --cases local/cases.jsonl
grad-eval prepare --cases local/cases.jsonl --config local/run.json --out artifacts/baseline

# 직접 작성한 stdin/stdout 어댑터. 경로는 작업 디렉터리가 바뀌어도 찾을 수 있게 지정합니다.
grad-eval run --plan artifacts/baseline/plan.json -- python "$PWD/local/agent.py"

grad-eval review-template --runs artifacts/baseline/runs.jsonl --out local/reviews.jsonl
# 원출력과 원출처를 확인하고 검토자·날짜·근거·판정을 작성합니다.
grad-eval report --cases local/cases.jsonl --runs artifacts/baseline/runs.jsonl \
  --reviews local/reviews.jsonl --plan artifacts/baseline/plan.json --out artifacts/baseline/report.json

grad-eval compare --baseline artifacts/baseline/report.json \
  --candidate artifacts/candidate/report.json --condition C --split holdout \
  --out artifacts/comparison.json
```

`local/` 파일은 사용자가 작성하는 비공개 입력입니다. [입력 형식](docs/data-format.md)에 사례·설정·검토 예시가 있습니다. Claude Code를 연결하려면 [어댑터 안내](docs/adapters.md)를 먼저 읽으세요. 모델과 실행별 비용 한도를 명시해야 합니다.

## 판정 방식

- 자동 검사: `action`과 `facts`의 값·필드·자료형을 비교합니다.
- 근거 검토: 출처가 해당 주장을 뒷받침하고 적용 대상이 맞는지 확인합니다.
- 답변 검토: 본문에 잘못된 해석·모순·예외 누락이 없는지 확인합니다.

미실행·오류·검토 대기는 분모에서 빼지 않습니다. 모델의 자기평가나 신뢰도 숫자로 사람 검토를 대체하지 않습니다. 답변이 바뀌면 이전 검토를 재사용할 수 없도록 사례와 출력 해시를 연결합니다.

| 상태 | 의미 |
| --- | --- |
| `PASS` | 검토된 실제 holdout 사례의 필수 조건을 모두 충족 |
| `FAIL` | 검토된 실제 holdout에서 필수 조건 실패 확인 |
| `INCONCLUSIVE` | 합성 자료, 미검토 정답, 누락, 실행 오류 등으로 품질 판단 보류 |

`PASS`는 평가한 사례 범위의 결과입니다. 배포 승인이 아닙니다. 버전 비교는 성공→실패와 실패→성공을 각각 보여주므로 평균 점수에 가려진 회귀를 확인할 수 있습니다. 정답셋·원문·코드·모델 설정까지 달라지면 같은 실험으로 비교하지 않습니다.

## 구현 범위

실행 계획과 파일 스냅샷, 외부 명령 실행, 자동 검사와 사람 검토 연결, JSON/Markdown 보고서, 변경 전후 비교를 제공합니다. 테스트와 CI는 합성 자료와 가짜 프로세스로 동작합니다.

Claude 참조 어댑터의 C 조건은 제공된 Skill 문서를 읽고 활용하는 평가입니다. Claude의 네이티브 Skill 자동 탐색·선택을 검증하는 어댑터는 아닙니다. 실제 모델 호출과 ALLCLL 정책 정답셋의 검증 결과는 아직 없습니다.

실행기 자체는 OS 샌드박스가 아닙니다. 실제 평가 환경에서는 정답 파일·이전 결과·운영 자격 증명에 대한 접근을 별도로 제한해야 합니다. 비공개 WIKI, 학생 정보와 실행 원문은 공개 레포에 넣지 않습니다. 현재 실행기는 경과 시간을 기록하며 토큰 수는 수집하지 않은 경우 `null`로 남깁니다.

## 개발

```bash
python -m unittest discover -s tests -v
python -m pip wheel --no-deps . --wheel-dir dist
```

| 경로 | 역할 |
| --- | --- |
| `src/graduation_wiki_eval/core.py` | 사례·계획 검증, 채점, 버전 비교 |
| `runner.py` | 파일 스냅샷과 외부 어댑터 실행 |
| `adapters/claude_cli.py` | Claude Code 읽기 전용 참조 어댑터 |
| `reporting.py`, `cli.py` | 보고서와 명령행 인터페이스 |
| `sample/` | 공개 가능한 가상 규정·질문 |
| `tests/` | 누락·회귀·검토 바인딩·실행 오류 검증 |

평가 원칙은 [설계](docs/design.md), 기업 사례에서 참고한 부분은 [참고 자료](docs/references.md)에 정리했습니다.
