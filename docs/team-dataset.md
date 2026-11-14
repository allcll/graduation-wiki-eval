# 팀에서 같은 평가셋 사용하기

평가 도구와 평가 데이터는 별도로 버전 관리합니다. 이 공개 레포에는 실행기와 가상 예제만 두고, 실제 CS를 재구성한 문항·정답·검토 기록은 팀이 접근할 수 있는 비공개 레포에 둡니다.

## 처음 받는 사람

도구와 데이터 레포를 각각 checkout하고 도구에서 `npm ci && npm run build`를 실행합니다. 아래 경로는 실행할 때 지정하므로 두 레포를 어디에 두어도 됩니다.

```sh
node dist/cli.js dataset-check \
  --root ../allcll-graduation-wiki \
  --manifest datasets/graduation-2026-2/v1/manifest.json

node dist/cli.js dataset-review \
  --root ../allcll-graduation-wiki \
  --manifest datasets/graduation-2026-2/v1/manifest.json \
  --out local/team-review-v1
```

첫 명령은 문항·정답·검토 기록·출처 파일의 SHA-256과 검토 승인 연결을 확인합니다. 두 번째 명령은 같은 검사를 통과한 뒤 새 검토 폴더를 만듭니다. 모델을 호출하지 않습니다.

| 생성 파일 | 용도 |
| --- | --- |
| `review.html` | 기존 검토 상태를 불러온 화면 |
| `review.workspace.json` | 이어서 검토할 수 있는 기록 |
| `sources/`, `source-links.json` | PDF 사본과 상대 경로·페이지 연결 |
| `cases.jsonl`, `pilot.cases.jsonl` | 전체 문항과 소규모 연결 확인용 문항 |
| `dataset-lock.json` | 사용한 manifest와 데이터셋 해시 |

HTML만 옮기지 말고 생성 폴더 전체를 옮겨야 합니다. 원문 버튼은 폴더 안의 PDF를 가리키므로 다른 컴퓨터에서도 동작합니다. 이 폴더에는 정답이 있으므로 모델의 `context_root`로 사용하지 않습니다. 답변에 필요한 원문·WIKI·Skill만 별도 디렉토리에 준비해 [최초 평가 절차](first-evaluation.md)의 `prepare`로 넘깁니다.

## 버전과 수정 방법

`manifest.json`의 모든 경로는 `--root` 기준 상대 경로입니다. 개인 홈 경로나 원격 URL로 파일을 암묵적으로 내려받지 않습니다. PDF는 기존 WIKI 파일을 사용하고 해시로 같은 판본인지 확인합니다. 문항 수뿐 아니라 편람·검토 기록까지 달라지면 검증이 실패합니다.

- 한 평가에 사용한 데이터 릴리스는 덮어쓰지 않고 다음 버전 디렉토리를 만듭니다.
- 질문·정답·근거·채점 기준을 바꾸면 검토 화면에서 다시 승인하고 `oracle-export`로 내보냅니다. 새 파일 해시는 `shasum -a 256 FILE`로 확인해 manifest에 기록합니다.
- manifest, 문항, 초안, 검토 workspace, 생성·승인 이력을 함께 PR로 올립니다. 해시는 파일 변경을 감지할 뿐 사람의 실제 검토를 증명하는 서명은 아닙니다.
- 팀은 데이터 레포와 평가 도구의 커밋 SHA를 함께 기록합니다. 같은 데이터라도 모델·프롬프트·자료·실행 조건이 다르면 같은 실험이 아닙니다.

현재 ALLCLL v1은 112건 전부 개발용(`dev`)입니다. 정답 초안 채택 승인과 모델 응답에 대한 사람 채점은 별개이며, 이 자료만으로 독립적인 최종 성능이나 전체 커버리지를 주장하지 않습니다. 원본 생성 이력과 승인 범위는 비공개 데이터 레포에 보존합니다.
