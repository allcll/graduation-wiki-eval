# graduation-wiki-eval

졸업요건 WIKI와 Skill의 변경 효과를 확인하는 평가 도구입니다.

main에 먼저 반영했던 구현을 작업 단위의 PR로 나누어 검토하고 있습니다. 기존 커밋은 이력에 보존했으며, 완성본은 [재구성 전 백업 브랜치](https://github.com/allcll/graduation-wiki-eval/tree/codex/archive-before-pr-split-20261111)에서 확인할 수 있습니다.

검토 순서는 다음과 같습니다.

1. 평가 기준과 TypeScript 채점 코어
2. 조건별 실행기와 자료 스냅샷
3. CLI, 보고서, 합성 데모
4. Claude Code 참조 어댑터
5. README, 사용 문서, PR 작성 양식

뒤의 PR은 앞 PR의 브랜치를 기준으로 작성합니다. 각 PR에서 해당 작업의 변경만 확인하고, 위 순서대로 병합할 수 있습니다.

공개 예제는 합성 자료이며 실제 ALLCLL WIKI의 성능 측정 결과가 아닙니다.
