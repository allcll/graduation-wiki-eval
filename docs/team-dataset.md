# 팀에서 같은 평가셋 사용하기

공개 가능한 평가 문항·정답·채점 기준·검토 기록은 이 레포의 [`datasets/`](../datasets/README.md)에 둡니다. 실행 도구와 평가셋을 함께 checkout하고 데이터 버전으로 비교 조건을 고정합니다. WIKI는 평가 대상 지식을 관리하는 역할을 유지합니다.

## 처음 사용하는 사람

[2026-2 v1 준비 절차](../datasets/graduation-2026-2/v1/README.md)에 따라 빌드하고 공식 편람을 받습니다. 비공개 WIKI 접근 없이 데이터셋 검증과 정답지 검토 화면 생성을 할 수 있습니다. 실제 B/C 평가에는 별도의 WIKI·Skill 컨텍스트가 필요합니다.

```sh
node dist/cli.js dataset-check --root . \
  --manifest datasets/graduation-2026-2/v1/manifest.json
node dist/cli.js dataset-review --root . \
  --manifest datasets/graduation-2026-2/v1/manifest.json --out local/team-review-v1
```

`dataset-check`는 문항·검토 기록·출처 파일의 SHA-256과 승인된 정답지의 일치를 확인합니다. `--metadata-only`를 명시하면 다운로드할 편람 파일 검증만 생략하고 `source_assets_verified: false`로 표시합니다. CI는 이 모드로 외부 다운로드와 모델 호출 없이 평가셋을 검사합니다.

`dataset-review`는 전체 검증 후 다음 파일을 새 폴더에 만듭니다. 원본이 없거나 판본이 다르면 화면을 생성하지 않습니다.

| 생성 파일 | 용도 |
| --- | --- |
| `review.html` | 기존 검토 상태를 불러온 화면 |
| `review.workspace.json` | 이어서 검토할 수 있는 기록 |
| `sources/`, `source-links.json` | PDF 사본과 상대 경로·페이지 연결 |
| `cases.jsonl`, `pilot.cases.jsonl` | 전체 문항과 소규모 연결 확인용 문항 |
| `dataset-lock.json` | 사용한 manifest와 데이터셋 해시 |

HTML만 옮기지 말고 폴더 전체를 옮깁니다. 원문 버튼은 폴더 안의 PDF를 가리키므로 컴퓨터의 설치 경로가 달라도 동작합니다. 공개 레포에 정답이 있다는 사실과 모델에 정답을 제공하는 것은 별개입니다. `datasets/`와 생성된 검토 폴더는 `context_root`로 사용하지 않습니다. 답변에 필요한 자료만 별도로 준비해 [최초 평가 절차](first-evaluation.md)의 `prepare`로 넘깁니다.

## 수정과 재현

manifest의 경로는 `--root` 기준 상대 경로입니다. 새 평가셋은 기존 릴리스를 덮어쓰지 않고 별도 버전으로 추가합니다. 질문·정답·근거·기준이 바뀌면 검토 화면에서 다시 승인하고 `oracle-export`로 내보낸 뒤 `shasum -a 256 FILE`로 파일 해시를 기록합니다. manifest·문항·초안·검토 기록·작성 이력을 함께 PR로 검토합니다.

해시는 파일 변경을 감지하며 사람의 실제 원문 대조를 증명하는 서명은 아닙니다. 같은 평가셋이어도 모델·프롬프트·자료·실행 제한이 다르면 같은 실험으로 비교하지 않습니다. 현재 112건은 전부 개발용이며 실제 모델 성능 측정 결과와 구분합니다.
