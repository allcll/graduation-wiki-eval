# 실행 상태와 평가 결과를 나눈 60개 응답 재검사

2026-11-15에 저장한 20개 사례 × A/B/C 응답을 다시 검사했습니다. 질문·WIKI·Skill·답변을 바꾸지 않았고 추가 모델 호출은 0회입니다. 당시 111개 사례 × A/B/C 전체 계획 중 저장된 60개 응답만 대상으로 했습니다.

기존 기록에서는 인용·Skill 검사에 걸린 55개가 실행 오류로 표시됐습니다. 이번 보고서는 완전한 응답과 모델 프로세스의 정상 종료를 확인해 **응답 생성 완료 60개**와 평가 결과를 분리합니다. 이전 run과 보고서 파일을 수정하지 않았으며, 원본 270개 파일의 해시가 모두 같음을 확인했습니다.

## 먼저 확인할 내용

- 정답값 일치는 54/60으로 이전과 같습니다. 검사기를 바꾼 결과를 모델 성능 향상으로 해석하지 않습니다.
- 자동으로 확인한 인용 검사 실패는 A의 CS-006(메타데이터 형식 2개), CS-016(인용한 페이지 전달 기록 누락 2개)입니다. 이는 확인 절차·형식 위반이며 답변의 의미 오류 개수와 같지 않습니다.
- C의 필수 문서 전체 읽기 누락 9개는 실패로 유지합니다. 당시 기록을 새로운 문서 전달 방식으로 읽은 것처럼 바꾸지 않았습니다.
- 자동 검증 불가인 인용 73개에는 미지원 표·설명 혼합 62개뿐 아니라 원문 단어·단위 변경 10개, 잘못된 표 관계 1개도 포함됩니다. 이 분류는 기존 AI 원문 대조 메모이고 사람 검토는 아직 대기입니다. 코드로 증명하지 못했다는 이유로 실제 내용 오류를 숨기거나 통과 처리하지 않습니다.

인용 확인됨은 여전히 15개 답변이며, 나머지를 확인된 실패와 판단 불가로 나눴습니다. 질문의 학번·대상·예외에 맞는 근거인지는 60개 모두 사람 검토가 필요합니다.

[사용 명령과 입력 형식](../offline-report.md) · [해시와 항목별 판정](execution-evaluation-recheck.observations.json)

추가 모델 호출 0회. 선택한 저장 응답만 대조한 오프라인 보고서이며, 전체 계획의 실행률·품질 승인·새 모델 성능을 뜻하지 않습니다. 기존 run·report는 그대로 보존합니다.

## 응답 생성과 평가 결과

| 조건 | 응답 생성 | 정답값 일치 | 인용 확인됨 | 인용 실패 확인 | 인용 자동 검증 불가 | Skill 읽기 실패 | 사람 검토 대기 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| A | 20 | 18 | 6 | 2 | 12 | 0 | 20 |
| B | 20 | 19 | 4 | 0 | 16 | 0 | 20 |
| C | 20 | 17 | 5 | 0 | 15 | 9 | 20 |

위 표의 단위는 답변입니다. 인용 하나가 미검증이면 해당 답변의 인용 판정도 미검증입니다. 실패와 미검증이 함께 있으면 대표 상태는 실패이지만 상세에는 둘 다 남깁니다. 정답값 일치는 자연어 답변 전체의 정확성이나 근거 충분성을 보장하지 않습니다.

개별 인용: 확인됨 99, 실패 확인 4, 자동 검증 불가 73.

## 자동 검사와 별도 분석의 차이

자동 검증 불가에는 미지원 표와 실제 단어 오류가 함께 있을 수 있습니다. 아래 AI 분석 메모는 원문 대조에서 발견한 내용을 보여주지만 자동 판정이나 사람 승인을 덮어쓰지 않습니다. 메모는 답변·인용·원문 해시와 묶었습니다.

## 답변별 확인할 내용

<details><summary>CS-2026-2-002 / A — 응답 생성 완료 · 인용 자동 검증 불가</summary>

기존 run 상태: error. 정답값: pass. Skill 읽기: not_requested. 사람 검토: 대기.

- **자동 검증 불가** citation_0:quote_unverified: 문구나 표 관계를 현재 검사 범위에서 확인하지 못했습니다. 내용 오류로 확정한 결과가 아닙니다. 다음 확인: 원문 페이지와 인용을 대조해 오타·설명 혼합·미지원 표를 구분하세요. 확인 전에는 통과로 세지 않습니다.

AI 원문 대조 메모 — 사람 검토 전:

- 인용 1 / table_relationship_unhandled: p53 자연과과학 영역과 제외계열 병합셀은 대응한다. 현재 문법은 과목·학점 없는 영역→제외계열 조회를 지원하지 않는다.

</details>

<details><summary>CS-2026-2-002 / B — 응답 생성 완료 · 인용 자동 검증 불가</summary>

기존 run 상태: error. 정답값: pass. Skill 읽기: not_requested. 사람 검토: 대기.

- **자동 검증 불가** citation_1:quote_unverified: 문구나 표 관계를 현재 검사 범위에서 확인하지 못했습니다. 내용 오류로 확정한 결과가 아닙니다. 다음 확인: 원문 페이지와 인용을 대조해 오타·설명 혼합·미지원 표를 구분하세요. 확인 전에는 통과로 세지 않습니다.
- **자동 검증 불가** citation_2:quote_unverified: 문구나 표 관계를 현재 검사 범위에서 확인하지 못했습니다. 내용 오류로 확정한 결과가 아닙니다. 다음 확인: 원문 페이지와 인용을 대조해 오타·설명 혼합·미지원 표를 구분하세요. 확인 전에는 통과로 세지 않습니다.

AI 원문 대조 메모 — 사람 검토 전:

- 인용 2 / table_relationship_unhandled: p53 영역·제외계열 머리글과 자연과과학 행의 값은 대응한다. 머리글을 붙인 영역→제외계열 인용은 지원하지 않는다.
- 인용 3 / table_relationship_unhandled: p53 문화와예술→예체능 제외계열 관계는 맞다. 머리글 및 과목·학점 없는 관계가 현재 문법 밖이다.

</details>

<details><summary>CS-2026-2-002 / C — 응답 생성 완료 · 인용 자동 검증 불가</summary>

기존 run 상태: error. 정답값: fail. Skill 읽기: pass. 사람 검토: 대기.

- **자동 검증 불가** citation_0:quote_unverified: 문구나 표 관계를 현재 검사 범위에서 확인하지 못했습니다. 내용 오류로 확정한 결과가 아닙니다. 다음 확인: 원문 페이지와 인용을 대조해 오타·설명 혼합·미지원 표를 구분하세요. 확인 전에는 통과로 세지 않습니다.
- 정답값 불일치: facts.excluded_area / mismatch — 기대값 "문화와예술", 응답값 "자연과과학,문화와예술"

AI 원문 대조 메모 — 사람 검토 전:

- 인용 1 / table_relationship_unhandled: p36 자연과과학의 제외계열 병합셀 4줄이다. PDF에서는 한 셀이지만 텍스트 추출 시 옆 과목 행과 섞인다.

</details>

<details><summary>CS-2026-2-003 / A — 응답 생성 완료 · 인용 자동 검증 불가</summary>

기존 run 상태: error. 정답값: pass. Skill 읽기: not_requested. 사람 검토: 대기.

- **자동 검증 불가** citation_1:quote_unverified: 문구나 표 관계를 현재 검사 범위에서 확인하지 못했습니다. 내용 오류로 확정한 결과가 아닙니다. 다음 확인: 원문 페이지와 인용을 대조해 오타·설명 혼합·미지원 표를 구분하세요. 확인 전에는 통과로 세지 않습니다.

AI 원문 대조 메모 — 사람 검토 전:

- 인용 2 / table_relationship_unhandled: p4 교양선택 개편표의 변경 전 교양선택(1영역) 비고 값이다. 옆 열과 머리글이 텍스트에 끼어든다. 이것을 현행 요건으로 적용해도 되는지는 별도 문제다.

</details>

<details><summary>CS-2026-2-003 / B — 응답 생성 완료 · 인용 자동 검증 불가</summary>

기존 run 상태: error. 정답값: pass. Skill 읽기: not_requested. 사람 검토: 대기.

- **자동 검증 불가** citation_2:quote_unverified: 문구나 표 관계를 현재 검사 범위에서 확인하지 못했습니다. 내용 오류로 확정한 결과가 아닙니다. 다음 확인: 원문 페이지와 인용을 대조해 오타·설명 혼합·미지원 표를 구분하세요. 확인 전에는 통과로 세지 않습니다.

AI 원문 대조 메모 — 사람 검토 전:

- 인용 3 / table_relationship_unhandled: p61 표의 머리글들을 나열했다. 머리글 자체는 존재하지만 특정 학과의 정책 주장까지 뒷받침하는 충분한 근거는 아니다.

</details>

<details><summary>CS-2026-2-003 / C — 응답 생성 완료 · 인용 확인됨</summary>

기존 run 상태: error. 정답값: pass. Skill 읽기: fail. 사람 검토: 대기.

- **실패 확인** required_skill_reads: 필수 문서 전체 읽기 누락: context/skills/skill-bundle/docs/agent-harness/PROJECT.md 다음 확인: 기존 읽기 누락을 그대로 유지하고 문서 전달 절차를 확인하세요.

</details>

<details><summary>CS-2026-2-004 / A — 응답 생성 완료 · 인용 자동 검증 불가</summary>

기존 run 상태: error. 정답값: pass. Skill 읽기: not_requested. 사람 검토: 대기.

- **자동 검증 불가** citation_0:quote_unverified: 문구나 표 관계를 현재 검사 범위에서 확인하지 못했습니다. 내용 오류로 확정한 결과가 아닙니다. 다음 확인: 원문 페이지와 인용을 대조해 오타·설명 혼합·미지원 표를 구분하세요. 확인 전에는 통과로 세지 않습니다.

AI 원문 대조 메모 — 사람 검토 전:

- 인용 1 / table_relationship_unhandled: p53 자연과과학→현대과학으로의초대→3→제외계열→2-4학년 관계는 맞다. 현재 색인은 이수시기 열 연결을 지원하지 않는다.

</details>

<details><summary>CS-2026-2-004 / B — 응답 생성 완료 · 인용 자동 검증 불가</summary>

기존 run 상태: error. 정답값: pass. Skill 읽기: not_requested. 사람 검토: 대기.

- **자동 검증 불가** citation_1:quote_unverified: 문구나 표 관계를 현재 검사 범위에서 확인하지 못했습니다. 내용 오류로 확정한 결과가 아닙니다. 다음 확인: 원문 페이지와 인용을 대조해 오타·설명 혼합·미지원 표를 구분하세요. 확인 전에는 통과로 세지 않습니다.

AI 원문 대조 메모 — 사람 검토 전:

- 인용 2 / table_relationship_unhandled: p53 자연과과학의 제외계열 병합셀과 대응한다. 과목·학점 없이 머리글과 제외계열을 연결한 인용이다.

</details>

<details><summary>CS-2026-2-004 / C — 응답 생성 완료 · 인용 자동 검증 불가</summary>

기존 run 상태: error. 정답값: pass. Skill 읽기: fail. 사람 검토: 대기.

- **자동 검증 불가** citation_1:quote_unverified: 문구나 표 관계를 현재 검사 범위에서 확인하지 못했습니다. 내용 오류로 확정한 결과가 아닙니다. 다음 확인: 원문 페이지와 인용을 대조해 오타·설명 혼합·미지원 표를 구분하세요. 확인 전에는 통과로 세지 않습니다.
- **실패 확인** required_skill_reads: 필수 문서 전체 읽기 누락: context/skills/skill-bundle/docs/agent-harness/PROJECT.md 다음 확인: 기존 읽기 누락을 그대로 유지하고 문서 전달 절차를 확인하세요.

AI 원문 대조 메모 — 사람 검토 전:

- 인용 2 / table_relationship_unhandled: p53 자연과과학의 제외계열 병합셀과 대응한다. 과목·학점 없이 머리글과 제외계열을 연결한 인용이다.

</details>

<details><summary>CS-2026-2-005 / A — 응답 생성 완료 · 인용 확인됨</summary>

기존 run 상태: error. 정답값: pass. Skill 읽기: not_requested. 사람 검토: 대기.


</details>

<details><summary>CS-2026-2-005 / B — 응답 생성 완료 · 인용 자동 검증 불가</summary>

기존 run 상태: error. 정답값: pass. Skill 읽기: not_requested. 사람 검토: 대기.

- **자동 검증 불가** citation_0:quote_unverified: 문구나 표 관계를 현재 검사 범위에서 확인하지 못했습니다. 내용 오류로 확정한 결과가 아닙니다. 다음 확인: 원문 페이지와 인용을 대조해 오타·설명 혼합·미지원 표를 구분하세요. 확인 전에는 통과로 세지 않습니다.
- **자동 검증 불가** citation_1:quote_unverified: 문구나 표 관계를 현재 검사 범위에서 확인하지 못했습니다. 내용 오류로 확정한 결과가 아닙니다. 다음 확인: 원문 페이지와 인용을 대조해 오타·설명 혼합·미지원 표를 구분하세요. 확인 전에는 통과로 세지 않습니다.
- **자동 검증 불가** citation_3:quote_unverified: 문구나 표 관계를 현재 검사 범위에서 확인하지 못했습니다. 내용 오류로 확정한 결과가 아닙니다. 다음 확인: 원문 페이지와 인용을 대조해 오타·설명 혼합·미지원 표를 구분하세요. 확인 전에는 통과로 세지 않습니다.

AI 원문 대조 메모 — 사람 검토 전:

- 인용 1 / table_quote_with_added_explanation: p53 한국현대사 3학점·인문과학 제외는 맞다. 대시 뒤의 2022학년도 표 설명은 모델이 구성한 설명이며 해당 페이지의 연속 원문 인용이 아니다.
- 인용 2 / table_quote_with_added_explanation: p53 생명과학의이해 3학점·제외계열은 맞다. 대시 뒤의 표 설명을 인용문 안에 추가했다.
- 인용 4 / table_relationship_unhandled: p53 균형교양 표의 학점 합계는 6이다. 현재 영역→과목→학점 문법은 합계 행을 지원하지 않는다.

</details>

<details><summary>CS-2026-2-005 / C — 응답 생성 완료 · 인용 자동 검증 불가</summary>

기존 run 상태: error. 정답값: pass. Skill 읽기: pass. 사람 검토: 대기.

- **자동 검증 불가** citation_0:quote_unverified: 문구나 표 관계를 현재 검사 범위에서 확인하지 못했습니다. 내용 오류로 확정한 결과가 아닙니다. 다음 확인: 원문 페이지와 인용을 대조해 오타·설명 혼합·미지원 표를 구분하세요. 확인 전에는 통과로 세지 않습니다.
- **자동 검증 불가** citation_1:quote_unverified: 문구나 표 관계를 현재 검사 범위에서 확인하지 못했습니다. 내용 오류로 확정한 결과가 아닙니다. 다음 확인: 원문 페이지와 인용을 대조해 오타·설명 혼합·미지원 표를 구분하세요. 확인 전에는 통과로 세지 않습니다.

AI 원문 대조 메모 — 사람 검토 전:

- 인용 1 / table_relationship_unhandled: p48 역사와사상→한국현대사→3은 같은 영역/행이다. p48 표 색인이 없다.
- 인용 2 / table_relationship_unhandled: p48 자연과과학→생명과학의이해→3은 같은 영역/행이다. p48 표 색인이 없다.

</details>

<details><summary>CS-2026-2-006 / A — 응답 생성 완료 · 인용 실패 확인</summary>

기존 run 상태: error. 정답값: pass. Skill 읽기: not_requested. 사람 검토: 대기.

- **실패 확인** citation_0:format: 인용 메타데이터 형식이 올바르지 않습니다. 다음 확인: 출처·판본·페이지 형식을 확인하세요. 파싱 실패를 별도의 판본 오류로 중복 집계하지 않습니다.
- **실패 확인** citation_1:format: 인용 메타데이터 형식이 올바르지 않습니다. 다음 확인: 출처·판본·페이지 형식을 확인하세요. 파싱 실패를 별도의 판본 오류로 중복 집계하지 않습니다.

AI 원문 대조 메모 — 사람 검토 전:

- 인용 1 / citation_metadata_format: pdf_page=48;]의 여분 세미콜론 때문에 파싱되지 않는다. 뒤의 한국현대사 표 정보는 p48에서 확인되지만 형식 수정만으로 p48 표 검증까지 해결되는 것은 아니다.
- 인용 2 / citation_metadata_format: pdf_page=48;]의 여분 세미콜론 때문에 파싱되지 않는다. 뒤의 수의세계·제외계열은 p48에서 확인되며 이 표 자체도 현재 미지원이다.

</details>

<details><summary>CS-2026-2-006 / B — 응답 생성 완료 · 인용 자동 검증 불가</summary>

기존 run 상태: error. 정답값: pass. Skill 읽기: not_requested. 사람 검토: 대기.

- **자동 검증 불가** citation_0:quote_unverified: 문구나 표 관계를 현재 검사 범위에서 확인하지 못했습니다. 내용 오류로 확정한 결과가 아닙니다. 다음 확인: 원문 페이지와 인용을 대조해 오타·설명 혼합·미지원 표를 구분하세요. 확인 전에는 통과로 세지 않습니다.
- **자동 검증 불가** citation_1:quote_unverified: 문구나 표 관계를 현재 검사 범위에서 확인하지 못했습니다. 내용 오류로 확정한 결과가 아닙니다. 다음 확인: 원문 페이지와 인용을 대조해 오타·설명 혼합·미지원 표를 구분하세요. 확인 전에는 통과로 세지 않습니다.

AI 원문 대조 메모 — 사람 검토 전:

- 인용 1 / table_relationship_unhandled: p48 한국현대사→3→인문과학 제외는 동일 행과 병합셀 범위에 속한다. p48 색인이 없다.
- 인용 2 / table_relationship_unhandled: p48 수의세계→3→제외계열은 대응한다. 셀 안의 줄바꿈도 쉼표로 바꾸었으므로 원문 셀 표현을 보존하는 구조화가 필요하다.

</details>

<details><summary>CS-2026-2-006 / C — 응답 생성 완료 · 인용 자동 검증 불가</summary>

기존 run 상태: error. 정답값: pass. Skill 읽기: pass. 사람 검토: 대기.

- **자동 검증 불가** citation_2:quote_unverified: 문구나 표 관계를 현재 검사 범위에서 확인하지 못했습니다. 내용 오류로 확정한 결과가 아닙니다. 다음 확인: 원문 페이지와 인용을 대조해 오타·설명 혼합·미지원 표를 구분하세요. 확인 전에는 통과로 세지 않습니다.
- **자동 검증 불가** citation_3:quote_unverified: 문구나 표 관계를 현재 검사 범위에서 확인하지 못했습니다. 내용 오류로 확정한 결과가 아닙니다. 다음 확인: 원문 페이지와 인용을 대조해 오타·설명 혼합·미지원 표를 구분하세요. 확인 전에는 통과로 세지 않습니다.

AI 원문 대조 메모 — 사람 검토 전:

- 인용 3 / table_relationship_unhandled: p48 한국현대사→3→인문과학 제외는 동일 행과 병합셀 범위에 속한다. p48 색인이 없다.
- 인용 4 / table_relationship_unhandled: p48 수의세계→3→제외계열은 대응한다. 셀 안의 줄바꿈도 쉼표로 바꾸었으므로 원문 셀 표현을 보존하는 구조화가 필요하다.

</details>

<details><summary>CS-2026-2-007 / A — 응답 생성 완료 · 인용 확인됨</summary>

기존 run 상태: error. 정답값: pass. Skill 읽기: not_requested. 사람 검토: 대기.


</details>

<details><summary>CS-2026-2-007 / B — 응답 생성 완료 · 인용 확인됨</summary>

기존 run 상태: error. 정답값: pass. Skill 읽기: not_requested. 사람 검토: 대기.


</details>

<details><summary>CS-2026-2-007 / C — 응답 생성 완료 · 인용 자동 검증 불가</summary>

기존 run 상태: error. 정답값: pass. Skill 읽기: fail. 사람 검토: 대기.

- **자동 검증 불가** citation_0:quote_unverified: 문구나 표 관계를 현재 검사 범위에서 확인하지 못했습니다. 내용 오류로 확정한 결과가 아닙니다. 다음 확인: 원문 페이지와 인용을 대조해 오타·설명 혼합·미지원 표를 구분하세요. 확인 전에는 통과로 세지 않습니다.
- **자동 검증 불가** citation_1:quote_unverified: 문구나 표 관계를 현재 검사 범위에서 확인하지 못했습니다. 내용 오류로 확정한 결과가 아닙니다. 다음 확인: 원문 페이지와 인용을 대조해 오타·설명 혼합·미지원 표를 구분하세요. 확인 전에는 통과로 세지 않습니다.
- **실패 확인** required_skill_reads: 필수 문서 전체 읽기 누락: context/skills/skill-bundle/docs/agent-harness/PROJECT.md 다음 확인: 기존 읽기 누락을 그대로 유지하고 문서 전달 절차를 확인하세요.

AI 원문 대조 메모 — 사람 검토 전:

- 인용 1 / table_relationship_unhandled: p48 역사와사상→한국현대사→3은 같은 영역/행이다. p48 표 색인이 없다.
- 인용 2 / table_relationship_unhandled: p48 자연과과학→지구환경과기후변화→3이 맞다. p48 색인이 없다.

</details>

<details><summary>CS-2026-2-008 / A — 응답 생성 완료 · 인용 자동 검증 불가</summary>

기존 run 상태: error. 정답값: pass. Skill 읽기: not_requested. 사람 검토: 대기.

- **자동 검증 불가** citation_0:quote_unverified: 문구나 표 관계를 현재 검사 범위에서 확인하지 못했습니다. 내용 오류로 확정한 결과가 아닙니다. 다음 확인: 원문 페이지와 인용을 대조해 오타·설명 혼합·미지원 표를 구분하세요. 확인 전에는 통과로 세지 않습니다.

AI 원문 대조 메모 — 사람 검토 전:

- 인용 1 / table_relationship_unhandled: p48 지구환경과기후변화 3학점과 제외계열·2-4학년 병합셀은 맞다. 다섯 열 관계와 셀 안 구분자 처리가 필요하다.

</details>

<details><summary>CS-2026-2-008 / B — 응답 생성 완료 · 인용 자동 검증 불가</summary>

기존 run 상태: error. 정답값: pass. Skill 읽기: not_requested. 사람 검토: 대기.

- **자동 검증 불가** citation_0:quote_unverified: 문구나 표 관계를 현재 검사 범위에서 확인하지 못했습니다. 내용 오류로 확정한 결과가 아닙니다. 다음 확인: 원문 페이지와 인용을 대조해 오타·설명 혼합·미지원 표를 구분하세요. 확인 전에는 통과로 세지 않습니다.
- **자동 검증 불가** citation_1:quote_unverified: 문구나 표 관계를 현재 검사 범위에서 확인하지 못했습니다. 내용 오류로 확정한 결과가 아닙니다. 다음 확인: 원문 페이지와 인용을 대조해 오타·설명 혼합·미지원 표를 구분하세요. 확인 전에는 통과로 세지 않습니다.

AI 원문 대조 메모 — 사람 검토 전:

- 인용 1 / table_relationship_unhandled: p48 자연과과학→지구환경과기후변화→3이 맞다. p48 색인이 없다.
- 인용 2 / table_relationship_unhandled: p48 자연과과학 영역과 제외계열은 맞다. 과목 없이 머리글·제외계열만 연결하는 방식이다.

</details>

<details><summary>CS-2026-2-008 / C — 응답 생성 완료 · 인용 자동 검증 불가</summary>

기존 run 상태: error. 정답값: pass. Skill 읽기: pass. 사람 검토: 대기.

- **자동 검증 불가** citation_0:quote_unverified: 문구나 표 관계를 현재 검사 범위에서 확인하지 못했습니다. 내용 오류로 확정한 결과가 아닙니다. 다음 확인: 원문 페이지와 인용을 대조해 오타·설명 혼합·미지원 표를 구분하세요. 확인 전에는 통과로 세지 않습니다.
- **자동 검증 불가** citation_1:quote_unverified: 문구나 표 관계를 현재 검사 범위에서 확인하지 못했습니다. 내용 오류로 확정한 결과가 아닙니다. 다음 확인: 원문 페이지와 인용을 대조해 오타·설명 혼합·미지원 표를 구분하세요. 확인 전에는 통과로 세지 않습니다.

AI 원문 대조 메모 — 사람 검토 전:

- 인용 1 / table_relationship_unhandled: p47 페이지 제목 2023학년도와 균형교양 행의 2영역·6학점 문구를 이어 썼다. 두 위치 모두 존재하지만 연속 인용은 아니다.
- 인용 2 / table_relationship_unhandled: p48 지구환경과기후변화의 영역·학점·제외계열·이수시기 관계는 맞다. 머리글과 값의 교차 연결은 미지원이다.

</details>

<details><summary>CS-2026-2-009 / A — 응답 생성 완료 · 인용 확인됨</summary>

기존 run 상태: error. 정답값: pass. Skill 읽기: not_requested. 사람 검토: 대기.


</details>

<details><summary>CS-2026-2-009 / B — 응답 생성 완료 · 인용 자동 검증 불가</summary>

기존 run 상태: error. 정답값: pass. Skill 읽기: not_requested. 사람 검토: 대기.

- **자동 검증 불가** citation_0:quote_unverified: 문구나 표 관계를 현재 검사 범위에서 확인하지 못했습니다. 내용 오류로 확정한 결과가 아닙니다. 다음 확인: 원문 페이지와 인용을 대조해 오타·설명 혼합·미지원 표를 구분하세요. 확인 전에는 통과로 세지 않습니다.
- **자동 검증 불가** citation_1:quote_unverified: 문구나 표 관계를 현재 검사 범위에서 확인하지 못했습니다. 내용 오류로 확정한 결과가 아닙니다. 다음 확인: 원문 페이지와 인용을 대조해 오타·설명 혼합·미지원 표를 구분하세요. 확인 전에는 통과로 세지 않습니다.

AI 원문 대조 메모 — 사람 검토 전:

- 인용 1 / table_relationship_unhandled: p36 자연과과학→수의세계→3은 대응한다. p36 표 색인이 없다.
- 인용 2 / table_relationship_unhandled: p36 문화와예술→현대예술의이해→3은 대응한다. p36 표 색인이 없다.

</details>

<details><summary>CS-2026-2-009 / C — 응답 생성 완료 · 인용 확인됨</summary>

기존 run 상태: error. 정답값: pass. Skill 읽기: pass. 사람 검토: 대기.


</details>

<details><summary>CS-2026-2-010 / A — 응답 생성 완료 · 인용 자동 검증 불가</summary>

기존 run 상태: error. 정답값: pass. Skill 읽기: not_requested. 사람 검토: 대기.

- **자동 검증 불가** citation_1:quote_unverified: 문구나 표 관계를 현재 검사 범위에서 확인하지 못했습니다. 내용 오류로 확정한 결과가 아닙니다. 다음 확인: 원문 페이지와 인용을 대조해 오타·설명 혼합·미지원 표를 구분하세요. 확인 전에는 통과로 세지 않습니다.

AI 원문 대조 메모 — 사람 검토 전:

- 인용 2 / table_relationship_unhandled: p53 수의세계의 영역·학점·제외계열·이수시기 값은 대응한다. 머리글과 이수시기까지 포함한 인용은 현 문법 밖이다.

</details>

<details><summary>CS-2026-2-010 / B — 응답 생성 완료 · 인용 자동 검증 불가</summary>

기존 run 상태: error. 정답값: pass. Skill 읽기: not_requested. 사람 검토: 대기.

- **자동 검증 불가** citation_1:quote_unverified: 문구나 표 관계를 현재 검사 범위에서 확인하지 못했습니다. 내용 오류로 확정한 결과가 아닙니다. 다음 확인: 원문 페이지와 인용을 대조해 오타·설명 혼합·미지원 표를 구분하세요. 확인 전에는 통과로 세지 않습니다.

AI 원문 대조 메모 — 사람 검토 전:

- 인용 2 / table_relationship_unhandled: p53 수의세계의 영역과 제외계열은 대응한다. 머리글을 앞에 모아 쓰고 학점을 생략한 형태는 현 문법 밖이다.

</details>

<details><summary>CS-2026-2-010 / C — 응답 생성 완료 · 인용 자동 검증 불가</summary>

기존 run 상태: error. 정답값: pass. Skill 읽기: pass. 사람 검토: 대기.

- **자동 검증 불가** citation_0:quote_unverified: 문구나 표 관계를 현재 검사 범위에서 확인하지 못했습니다. 내용 오류로 확정한 결과가 아닙니다. 다음 확인: 원문 페이지와 인용을 대조해 오타·설명 혼합·미지원 표를 구분하세요. 확인 전에는 통과로 세지 않습니다.
- **자동 검증 불가** citation_1:quote_unverified: 문구나 표 관계를 현재 검사 범위에서 확인하지 못했습니다. 내용 오류로 확정한 결과가 아닙니다. 다음 확인: 원문 페이지와 인용을 대조해 오타·설명 혼합·미지원 표를 구분하세요. 확인 전에는 통과로 세지 않습니다.
- **자동 검증 불가** citation_3:quote_unverified: 문구나 표 관계를 현재 검사 범위에서 확인하지 못했습니다. 내용 오류로 확정한 결과가 아닙니다. 다음 확인: 원문 페이지와 인용을 대조해 오타·설명 혼합·미지원 표를 구분하세요. 확인 전에는 통과로 세지 않습니다.

AI 원문 대조 메모 — 사람 검토 전:

- 인용 1 / changed_source_word_or_unit: p53 셀 값은 3인데 3학점으로 썼다. 학점 열이므로 수량의 의미는 맞지만 직접 인용에 단위를 추가한 경우다.
- 인용 2 / table_relationship_unhandled: p53 자연과과학의 제외계열 병합셀과 대응한다. 과목·학점 없이 머리글과 제외계열을 연결한 인용이다.
- 인용 4 / changed_source_word_or_unit: p52 원문 학생 자율선택을 학생 자유선택으로 바꾸었다. 직접 인용의 단어 불일치다.

</details>

<details><summary>CS-2026-2-011 / A — 응답 생성 완료 · 인용 확인됨</summary>

기존 run 상태: ok. 정답값: fail. Skill 읽기: not_requested. 사람 검토: 대기.

- 정답값 불일치: facts.handbook_clause_category_name / mismatch — 기대값 "교양선택(2영역)", 응답값 "마.타학과전공선택인정교과목수강"

</details>

<details><summary>CS-2026-2-011 / B — 응답 생성 완료 · 인용 확인됨</summary>

기존 run 상태: error. 정답값: fail. Skill 읽기: not_requested. 사람 검토: 대기.

- 정답값 불일치: action / mismatch — 기대값 "clarify", 응답값 "answer"

</details>

<details><summary>CS-2026-2-011 / C — 응답 생성 완료 · 인용 확인됨</summary>

기존 run 상태: error. 정답값: pass. Skill 읽기: pass. 사람 검토: 대기.


</details>

<details><summary>CS-2026-2-012 / A — 응답 생성 완료 · 인용 자동 검증 불가</summary>

기존 run 상태: error. 정답값: pass. Skill 읽기: not_requested. 사람 검토: 대기.

- **자동 검증 불가** citation_1:quote_unverified: 문구나 표 관계를 현재 검사 범위에서 확인하지 못했습니다. 내용 오류로 확정한 결과가 아닙니다. 다음 확인: 원문 페이지와 인용을 대조해 오타·설명 혼합·미지원 표를 구분하세요. 확인 전에는 통과로 세지 않습니다.

AI 원문 대조 메모 — 사람 검토 전:

- 인용 2 / table_relationship_unhandled: p58 사상과역사→세계사:인간과문명→3과 2-2·2학년은 같은 행에 있다. 2-2와 2학년은 서로 다른 계열 열의 값이므로 적용 학과 확인은 별도로 필요하다.

</details>

<details><summary>CS-2026-2-012 / B — 응답 생성 완료 · 인용 확인됨</summary>

기존 run 상태: ok. 정답값: pass. Skill 읽기: not_requested. 사람 검토: 대기.


</details>

<details><summary>CS-2026-2-012 / C — 응답 생성 완료 · 인용 자동 검증 불가</summary>

기존 run 상태: error. 정답값: pass. Skill 읽기: pass. 사람 검토: 대기.

- **자동 검증 불가** citation_2:quote_unverified: 문구나 표 관계를 현재 검사 범위에서 확인하지 못했습니다. 내용 오류로 확정한 결과가 아닙니다. 다음 확인: 원문 페이지와 인용을 대조해 오타·설명 혼합·미지원 표를 구분하세요. 확인 전에는 통과로 세지 않습니다.

AI 원문 대조 메모 — 사람 검토 전:

- 인용 3 / table_relationship_unhandled: p58 사상과역사→세계사:인간과문명→3은 맞다. 해당 표 색인이 없다.

</details>

<details><summary>CS-2026-2-013 / A — 응답 생성 완료 · 인용 자동 검증 불가</summary>

기존 run 상태: error. 정답값: pass. Skill 읽기: not_requested. 사람 검토: 대기.

- **자동 검증 불가** citation_0:quote_unverified: 문구나 표 관계를 현재 검사 범위에서 확인하지 못했습니다. 내용 오류로 확정한 결과가 아닙니다. 다음 확인: 원문 페이지와 인용을 대조해 오타·설명 혼합·미지원 표를 구분하세요. 확인 전에는 통과로 세지 않습니다.
- **자동 검증 불가** citation_2:quote_unverified: 문구나 표 관계를 현재 검사 범위에서 확인하지 못했습니다. 내용 오류로 확정한 결과가 아닙니다. 다음 확인: 원문 페이지와 인용을 대조해 오타·설명 혼합·미지원 표를 구분하세요. 확인 전에는 통과로 세지 않습니다.

AI 원문 대조 메모 — 사람 검토 전:

- 인용 1 / table_relationship_unhandled: p15 2023학년도 입학자부터 행의 세 인증 중 2개 이상 규칙이다. 왼쪽 병합셀과 오른쪽 문단이 추출본에서 이어지지 않는다. 예체능 예외는 별도 검토 대상이다.
- 인용 3 / changed_source_word_or_unit: p15 면제 문장의 원문은 호텔외식관광프렌차이즈경영학과인데 인용은 프랜차이즈로 썼다. 같은 대상을 의도했더라도 원문 명칭과 다르다.

</details>

<details><summary>CS-2026-2-013 / B — 응답 생성 완료 · 인용 자동 검증 불가</summary>

기존 run 상태: error. 정답값: pass. Skill 읽기: not_requested. 사람 검토: 대기.

- **자동 검증 불가** citation_0:quote_unverified: 문구나 표 관계를 현재 검사 범위에서 확인하지 못했습니다. 내용 오류로 확정한 결과가 아닙니다. 다음 확인: 원문 페이지와 인용을 대조해 오타·설명 혼합·미지원 표를 구분하세요. 확인 전에는 통과로 세지 않습니다.

AI 원문 대조 메모 — 사람 검토 전:

- 인용 1 / changed_source_word_or_unit: p15 2023학년도를 2023학번도로 오기했다. 표 셀 결합 문제도 있으나 원문 오타를 우선 분류했다.

</details>

<details><summary>CS-2026-2-013 / C — 응답 생성 완료 · 인용 자동 검증 불가</summary>

기존 run 상태: error. 정답값: pass. Skill 읽기: fail. 사람 검토: 대기.

- **자동 검증 불가** citation_0:quote_unverified: 문구나 표 관계를 현재 검사 범위에서 확인하지 못했습니다. 내용 오류로 확정한 결과가 아닙니다. 다음 확인: 원문 페이지와 인용을 대조해 오타·설명 혼합·미지원 표를 구분하세요. 확인 전에는 통과로 세지 않습니다.
- **실패 확인** required_skill_reads: 필수 문서 전체 읽기 누락: context/skills/skill-bundle/CLAUDE.md, context/skills/skill-bundle/docs/agent-harness/PROJECT.md 다음 확인: 기존 읽기 누락을 그대로 유지하고 문서 전달 절차를 확인하세요.

AI 원문 대조 메모 — 사람 검토 전:

- 인용 1 / table_relationship_unhandled: p15 머리글·2023학년도 행·인증 목록을 연결했다. 원문의 셀 관계는 대응하지만 현재 이 표는 미지원이다.

</details>

<details><summary>CS-2026-2-014 / A — 응답 생성 완료 · 인용 자동 검증 불가</summary>

기존 run 상태: error. 정답값: pass. Skill 읽기: not_requested. 사람 검토: 대기.

- **자동 검증 불가** citation_0:quote_unverified: 문구나 표 관계를 현재 검사 범위에서 확인하지 못했습니다. 내용 오류로 확정한 결과가 아닙니다. 다음 확인: 원문 페이지와 인용을 대조해 오타·설명 혼합·미지원 표를 구분하세요. 확인 전에는 통과로 세지 않습니다.

AI 원문 대조 메모 — 사람 검토 전:

- 인용 1 / table_relationship_unhandled: p30 동일과목 병합셀 안에 세계사:인간과문명→세계사와 변경년도 2023이 있다. 올바른 관계지만 해당 색인이 없다.

</details>

<details><summary>CS-2026-2-014 / B — 응답 생성 완료 · 인용 자동 검증 불가</summary>

기존 run 상태: error. 정답값: pass. Skill 읽기: not_requested. 사람 검토: 대기.

- **자동 검증 불가** citation_0:quote_unverified: 문구나 표 관계를 현재 검사 범위에서 확인하지 못했습니다. 내용 오류로 확정한 결과가 아닙니다. 다음 확인: 원문 페이지와 인용을 대조해 오타·설명 혼합·미지원 표를 구분하세요. 확인 전에는 통과로 세지 않습니다.

AI 원문 대조 메모 — 사람 검토 전:

- 인용 1 / table_relationship_unhandled: p30 동일과목 병합셀 안에 세계사:인간과문명→세계사와 변경년도 2023이 있다. 올바른 관계지만 해당 색인이 없다.

</details>

<details><summary>CS-2026-2-014 / C — 응답 생성 완료 · 인용 자동 검증 불가</summary>

기존 run 상태: error. 정답값: fail. Skill 읽기: fail. 사람 검토: 대기.

- **자동 검증 불가** citation_1:quote_unverified: 문구나 표 관계를 현재 검사 범위에서 확인하지 못했습니다. 내용 오류로 확정한 결과가 아닙니다. 다음 확인: 원문 페이지와 인용을 대조해 오타·설명 혼합·미지원 표를 구분하세요. 확인 전에는 통과로 세지 않습니다.
- **자동 검증 불가** citation_2:quote_unverified: 문구나 표 관계를 현재 검사 범위에서 확인하지 못했습니다. 내용 오류로 확정한 결과가 아닙니다. 다음 확인: 원문 페이지와 인용을 대조해 오타·설명 혼합·미지원 표를 구분하세요. 확인 전에는 통과로 세지 않습니다.
- **실패 확인** required_skill_reads: 필수 문서 전체 읽기 누락: context/skills/skill-bundle/docs/agent-harness/PROJECT.md 다음 확인: 기존 읽기 누락을 그대로 유지하고 문서 전달 절차를 확인하세요.
- 정답값 불일치: facts.current_course_name / mismatch — 기대값 "세계사", 응답값 ""
- 정답값 불일치: facts.same_course_designation / mismatch — 기대값 true, 응답값 false

AI 원문 대조 메모 — 사람 검토 전:

- 인용 2 / wrong_table_relation: p30 세계사:인간과문명→세계사는 2023년 동일과목이다. 대체과목이라고 연결한 인용은 실제 관계 오류다.
- 인용 3 / table_relationship_unhandled: p30 동일과목 병합셀 안에 프로그래밍입문-P→프로그래밍활용-P가 있다. 실제 행의 문구와 관계는 맞지만 표 색인이 없다.

</details>

<details><summary>CS-2026-2-015 / A — 응답 생성 완료 · 인용 확인됨</summary>

기존 run 상태: ok. 정답값: pass. Skill 읽기: not_requested. 사람 검토: 대기.


</details>

<details><summary>CS-2026-2-015 / B — 응답 생성 완료 · 인용 확인됨</summary>

기존 run 상태: ok. 정답값: pass. Skill 읽기: not_requested. 사람 검토: 대기.


</details>

<details><summary>CS-2026-2-015 / C — 응답 생성 완료 · 인용 확인됨</summary>

기존 run 상태: ok. 정답값: pass. Skill 읽기: pass. 사람 검토: 대기.


</details>

<details><summary>CS-2026-2-016 / A — 응답 생성 완료 · 인용 실패 확인</summary>

기존 run 상태: error. 정답값: pass. Skill 읽기: not_requested. 사람 검토: 대기.

- **자동 검증 불가** citation_0:quote_unverified: 문구나 표 관계를 현재 검사 범위에서 확인하지 못했습니다. 내용 오류로 확정한 결과가 아닙니다. 다음 확인: 원문 페이지와 인용을 대조해 오타·설명 혼합·미지원 표를 구분하세요. 확인 전에는 통과로 세지 않습니다.
- **실패 확인** citation_1:page_read: 인용한 PDF 페이지가 전달된 기록이 없습니다. 다음 확인: 문구의 정확성과 원본 페이지 확인 절차를 구분해 검토하세요.
- **자동 검증 불가** citation_1:quote_unverified: 문구나 표 관계를 현재 검사 범위에서 확인하지 못했습니다. 내용 오류로 확정한 결과가 아닙니다. 다음 확인: 원문 페이지와 인용을 대조해 오타·설명 혼합·미지원 표를 구분하세요. 확인 전에는 통과로 세지 않습니다.
- **실패 확인** citation_2:page_read: 인용한 PDF 페이지가 전달된 기록이 없습니다. 다음 확인: 문구의 정확성과 원본 페이지 확인 절차를 구분해 검토하세요.

AI 원문 대조 메모 — 사람 검토 전:

- 인용 1 / table_quote_with_added_explanation: p49 반도체시스템 열의 공업수학1·일반물리학2는 각 3학점, 1-2이다. 두 행을 엮고 표/입학년도 설명을 덧붙였다.
- 인용 2 / table_quote_with_added_explanation: p4 공업수학1,2와 일반물리학1,2의 학문기초교양필수→전공기초 변경은 맞다. 두 행과 제목·시행 설명을 합쳤으며 해당 PDF 페이지 전달 기록도 없다.
- 인용 3 / original_page_not_read: p4 원문의 인용부호 차이는 이미 정규화되어 문구 검사를 통과한다. 남은 실패는 p4 PDF 전달 기록이 없다는 점이다.

</details>

<details><summary>CS-2026-2-016 / B — 응답 생성 완료 · 인용 자동 검증 불가</summary>

기존 run 상태: error. 정답값: pass. Skill 읽기: not_requested. 사람 검토: 대기.

- **자동 검증 불가** citation_0:quote_unverified: 문구나 표 관계를 현재 검사 범위에서 확인하지 못했습니다. 내용 오류로 확정한 결과가 아닙니다. 다음 확인: 원문 페이지와 인용을 대조해 오타·설명 혼합·미지원 표를 구분하세요. 확인 전에는 통과로 세지 않습니다.
- **자동 검증 불가** citation_1:quote_unverified: 문구나 표 관계를 현재 검사 범위에서 확인하지 못했습니다. 내용 오류로 확정한 결과가 아닙니다. 다음 확인: 원문 페이지와 인용을 대조해 오타·설명 혼합·미지원 표를 구분하세요. 확인 전에는 통과로 세지 않습니다.
- **자동 검증 불가** citation_3:quote_unverified: 문구나 표 관계를 현재 검사 범위에서 확인하지 못했습니다. 내용 오류로 확정한 결과가 아닙니다. 다음 확인: 원문 페이지와 인용을 대조해 오타·설명 혼합·미지원 표를 구분하세요. 확인 전에는 통과로 세지 않습니다.
- **자동 검증 불가** citation_4:quote_unverified: 문구나 표 관계를 현재 검사 범위에서 확인하지 못했습니다. 내용 오류로 확정한 결과가 아닙니다. 다음 확인: 원문 페이지와 인용을 대조해 오타·설명 혼합·미지원 표를 구분하세요. 확인 전에는 통과로 세지 않습니다.

AI 원문 대조 메모 — 사람 검토 전:

- 인용 1 / table_relationship_unhandled: p49 수리적분석→공업수학1→3은 대응한다. 해당 표 색인이 없다.
- 인용 2 / table_relationship_unhandled: p49 과학적사고와실험→일반물리학2→3은 대응한다. 해당 표 색인이 없다.
- 인용 4 / table_relationship_unhandled: p49 반도체시스템 열과 공업수학1 행의 교차 셀은 1-2이다. 행·열 교차 조회는 현재 미지원이다.
- 인용 5 / table_relationship_unhandled: p49 반도체시스템 열과 일반물리학2 행의 교차 셀은 1-2이다. 행·열 교차 조회는 현재 미지원이다.

</details>

<details><summary>CS-2026-2-016 / C — 응답 생성 완료 · 인용 자동 검증 불가</summary>

기존 run 상태: error. 정답값: pass. Skill 읽기: pass. 사람 검토: 대기.

- **자동 검증 불가** citation_0:quote_unverified: 문구나 표 관계를 현재 검사 범위에서 확인하지 못했습니다. 내용 오류로 확정한 결과가 아닙니다. 다음 확인: 원문 페이지와 인용을 대조해 오타·설명 혼합·미지원 표를 구분하세요. 확인 전에는 통과로 세지 않습니다.
- **자동 검증 불가** citation_1:quote_unverified: 문구나 표 관계를 현재 검사 범위에서 확인하지 못했습니다. 내용 오류로 확정한 결과가 아닙니다. 다음 확인: 원문 페이지와 인용을 대조해 오타·설명 혼합·미지원 표를 구분하세요. 확인 전에는 통과로 세지 않습니다.

AI 원문 대조 메모 — 사람 검토 전:

- 인용 1 / table_quote_with_added_explanation: p49 수리적분석·공업수학1·반도체시스템 1-2는 맞지만 원문에 없는 and를 인용 안에 삽입했다.
- 인용 2 / table_quote_with_added_explanation: p49 과학적사고와실험·일반물리학2·반도체시스템 1-2는 맞지만 원문에 없는 and를 삽입했다.

</details>

<details><summary>CS-2026-2-017 / A — 응답 생성 완료 · 인용 자동 검증 불가</summary>

기존 run 상태: error. 정답값: pass. Skill 읽기: not_requested. 사람 검토: 대기.

- **자동 검증 불가** citation_1:quote_unverified: 문구나 표 관계를 현재 검사 범위에서 확인하지 못했습니다. 내용 오류로 확정한 결과가 아닙니다. 다음 확인: 원문 페이지와 인용을 대조해 오타·설명 혼합·미지원 표를 구분하세요. 확인 전에는 통과로 세지 않습니다.
- **자동 검증 불가** citation_2:quote_unverified: 문구나 표 관계를 현재 검사 범위에서 확인하지 못했습니다. 내용 오류로 확정한 결과가 아닙니다. 다음 확인: 원문 페이지와 인용을 대조해 오타·설명 혼합·미지원 표를 구분하세요. 확인 전에는 통과로 세지 않습니다.

AI 원문 대조 메모 — 사람 검토 전:

- 인용 2 / table_relationship_unhandled: p43 소통역량→취창업과진로설계→1→3-4학년(건축학과 4-5학년)과 별도 합계 13은 맞다. 과목 행과 합계 행 결합은 미지원이다.
- 인용 3 / table_relationship_unhandled: p46 공과대학 국방시스템공학과 행의 12/9/12/12/45/28/73/85/130 값과 각 열은 대응한다. 여러 머리글·값 결합은 미지원이다.

</details>

<details><summary>CS-2026-2-017 / B — 응답 생성 완료 · 인용 자동 검증 불가</summary>

기존 run 상태: error. 정답값: pass. Skill 읽기: not_requested. 사람 검토: 대기.

- **자동 검증 불가** citation_0:quote_unverified: 문구나 표 관계를 현재 검사 범위에서 확인하지 못했습니다. 내용 오류로 확정한 결과가 아닙니다. 다음 확인: 원문 페이지와 인용을 대조해 오타·설명 혼합·미지원 표를 구분하세요. 확인 전에는 통과로 세지 않습니다.

AI 원문 대조 메모 — 사람 검토 전:

- 인용 1 / table_relationship_unhandled: p46 공과대학 국방시스템공학과 행의 12/9/12/12/45/28/73/85/130 값과 각 열은 대응한다. 여러 머리글·값 결합은 미지원이다.

</details>

<details><summary>CS-2026-2-017 / C — 응답 생성 완료 · 인용 자동 검증 불가</summary>

기존 run 상태: error. 정답값: pass. Skill 읽기: fail. 사람 검토: 대기.

- **자동 검증 불가** citation_2:quote_unverified: 문구나 표 관계를 현재 검사 범위에서 확인하지 못했습니다. 내용 오류로 확정한 결과가 아닙니다. 다음 확인: 원문 페이지와 인용을 대조해 오타·설명 혼합·미지원 표를 구분하세요. 확인 전에는 통과로 세지 않습니다.
- **실패 확인** required_skill_reads: 필수 문서 전체 읽기 누락: context/skills/skill-bundle/docs/agent-harness/PROJECT.md 다음 확인: 기존 읽기 누락을 그대로 유지하고 문서 전달 절차를 확인하세요.

AI 원문 대조 메모 — 사람 검토 전:

- 인용 3 / table_relationship_unhandled: p46 국방시스템공학과 행의 수치는 모두 대응한다. 소계·총계 머리글을 짧게 쓰고 여러 열을 연결했다.

</details>

<details><summary>CS-2026-2-018 / A — 응답 생성 완료 · 인용 자동 검증 불가</summary>

기존 run 상태: error. 정답값: fail. Skill 읽기: not_requested. 사람 검토: 대기.

- **자동 검증 불가** citation_1:quote_unverified: 문구나 표 관계를 현재 검사 범위에서 확인하지 못했습니다. 내용 오류로 확정한 결과가 아닙니다. 다음 확인: 원문 페이지와 인용을 대조해 오타·설명 혼합·미지원 표를 구분하세요. 확인 전에는 통과로 세지 않습니다.
- **자동 검증 불가** citation_2:quote_unverified: 문구나 표 관계를 현재 검사 범위에서 확인하지 못했습니다. 내용 오류로 확정한 결과가 아닙니다. 다음 확인: 원문 페이지와 인용을 대조해 오타·설명 혼합·미지원 표를 구분하세요. 확인 전에는 통과로 세지 않습니다.
- **자동 검증 불가** citation_3:quote_unverified: 문구나 표 관계를 현재 검사 범위에서 확인하지 못했습니다. 내용 오류로 확정한 결과가 아닙니다. 다음 확인: 원문 페이지와 인용을 대조해 오타·설명 혼합·미지원 표를 구분하세요. 확인 전에는 통과로 세지 않습니다.
- **자동 검증 불가** citation_4:quote_unverified: 문구나 표 관계를 현재 검사 범위에서 확인하지 못했습니다. 내용 오류로 확정한 결과가 아닙니다. 다음 확인: 원문 페이지와 인용을 대조해 오타·설명 혼합·미지원 표를 구분하세요. 확인 전에는 통과로 세지 않습니다.
- 정답값 불일치: action / mismatch — 기대값 "clarify", 응답값 "answer"

AI 원문 대조 메모 — 사람 검토 전:

- 인용 2 / table_quote_with_added_explanation: p16 전체 10권·서양의 역사와 사상 4권은 맞지만 원문에 없는 and로 연결했다.
- 인용 3 / table_quote_with_added_explanation: p16 전체 10권·동양의 역사와 사상 2권은 맞지만 원문에 없는 and로 연결했다.
- 인용 4 / table_quote_with_added_explanation: p16 전체 10권·동·서양의 문학 3권은 맞지만 원문에 없는 and로 연결했다.
- 인용 5 / table_quote_with_added_explanation: p16 전체 10권·과학 사상 1권은 맞지만 원문에 없는 and로 연결했다.

</details>

<details><summary>CS-2026-2-018 / B — 응답 생성 완료 · 인용 자동 검증 불가</summary>

기존 run 상태: error. 정답값: pass. Skill 읽기: not_requested. 사람 검토: 대기.

- **자동 검증 불가** citation_1:quote_unverified: 문구나 표 관계를 현재 검사 범위에서 확인하지 못했습니다. 내용 오류로 확정한 결과가 아닙니다. 다음 확인: 원문 페이지와 인용을 대조해 오타·설명 혼합·미지원 표를 구분하세요. 확인 전에는 통과로 세지 않습니다.
- **자동 검증 불가** citation_3:quote_unverified: 문구나 표 관계를 현재 검사 범위에서 확인하지 못했습니다. 내용 오류로 확정한 결과가 아닙니다. 다음 확인: 원문 페이지와 인용을 대조해 오타·설명 혼합·미지원 표를 구분하세요. 확인 전에는 통과로 세지 않습니다.

AI 원문 대조 메모 — 사람 검토 전:

- 인용 2 / table_relationship_unhandled: p16 전체 10권과 영역별 4/2/3/1권의 열 관계가 맞다. 머리글 행을 먼저, 값 행을 나중에 모은 형식은 미지원이다.
- 인용 4 / changed_source_word_or_unit: p16 이수 대상의 2012학년도를 2012학번도로 오기했다.

</details>

<details><summary>CS-2026-2-018 / C — 응답 생성 완료 · 인용 자동 검증 불가</summary>

기존 run 상태: error. 정답값: fail. Skill 읽기: fail. 사람 검토: 대기.

- **자동 검증 불가** citation_1:quote_unverified: 문구나 표 관계를 현재 검사 범위에서 확인하지 못했습니다. 내용 오류로 확정한 결과가 아닙니다. 다음 확인: 원문 페이지와 인용을 대조해 오타·설명 혼합·미지원 표를 구분하세요. 확인 전에는 통과로 세지 않습니다.
- **실패 확인** required_skill_reads: 필수 문서 전체 읽기 누락: context/skills/skill-bundle/docs/agent-harness/PROJECT.md 다음 확인: 기존 읽기 누락을 그대로 유지하고 문서 전달 절차를 확인하세요.
- 정답값 불일치: action / mismatch — 기대값 "clarify", 응답값 "answer"

AI 원문 대조 메모 — 사람 검토 전:

- 인용 2 / table_relationship_unhandled: p16 전체 10권과 영역별 4/2/3/1권의 열 관계가 맞다. 머리글 행을 먼저, 값 행을 나중에 모은 형식은 미지원이다.

</details>

<details><summary>CS-2026-2-019 / A — 응답 생성 완료 · 인용 자동 검증 불가</summary>

기존 run 상태: error. 정답값: pass. Skill 읽기: not_requested. 사람 검토: 대기.

- **자동 검증 불가** citation_5:quote_unverified: 문구나 표 관계를 현재 검사 범위에서 확인하지 못했습니다. 내용 오류로 확정한 결과가 아닙니다. 다음 확인: 원문 페이지와 인용을 대조해 오타·설명 혼합·미지원 표를 구분하세요. 확인 전에는 통과로 세지 않습니다.

AI 원문 대조 메모 — 사람 검토 전:

- 인용 6 / table_relationship_unhandled: p15 2012-2022학년도 행에 영어졸업인증·고전독서졸업인증이 있다. 셀 결합 인용이며 예체능 대체 조건까지 확인한 것은 아니다.

</details>

<details><summary>CS-2026-2-019 / B — 응답 생성 완료 · 인용 자동 검증 불가</summary>

기존 run 상태: error. 정답값: pass. Skill 읽기: not_requested. 사람 검토: 대기.

- **자동 검증 불가** citation_1:quote_unverified: 문구나 표 관계를 현재 검사 범위에서 확인하지 못했습니다. 내용 오류로 확정한 결과가 아닙니다. 다음 확인: 원문 페이지와 인용을 대조해 오타·설명 혼합·미지원 표를 구분하세요. 확인 전에는 통과로 세지 않습니다.
- **자동 검증 불가** citation_3:quote_unverified: 문구나 표 관계를 현재 검사 범위에서 확인하지 못했습니다. 내용 오류로 확정한 결과가 아닙니다. 다음 확인: 원문 페이지와 인용을 대조해 오타·설명 혼합·미지원 표를 구분하세요. 확인 전에는 통과로 세지 않습니다.
- **자동 검증 불가** citation_4:quote_unverified: 문구나 표 관계를 현재 검사 범위에서 확인하지 못했습니다. 내용 오류로 확정한 결과가 아닙니다. 다음 확인: 원문 페이지와 인용을 대조해 오타·설명 혼합·미지원 표를 구분하세요. 확인 전에는 통과로 세지 않습니다.

AI 원문 대조 메모 — 사람 검토 전:

- 인용 2 / changed_source_word_or_unit: p16 교환교류생을 교환학교류생으로 바꿨다. 제외 대상 명칭의 직접 인용 불일치다.
- 인용 4 / changed_source_word_or_unit: p16 고전독서인증을 고전도서인증으로 바꿨다.
- 인용 5 / changed_source_word_or_unit: p16 고전독서인증을 고전도서인증으로 바꿨다.

</details>

<details><summary>CS-2026-2-019 / C — 응답 생성 완료 · 인용 자동 검증 불가</summary>

기존 run 상태: error. 정답값: pass. Skill 읽기: fail. 사람 검토: 대기.

- **자동 검증 불가** citation_1:quote_unverified: 문구나 표 관계를 현재 검사 범위에서 확인하지 못했습니다. 내용 오류로 확정한 결과가 아닙니다. 다음 확인: 원문 페이지와 인용을 대조해 오타·설명 혼합·미지원 표를 구분하세요. 확인 전에는 통과로 세지 않습니다.
- **자동 검증 불가** citation_4:quote_unverified: 문구나 표 관계를 현재 검사 범위에서 확인하지 못했습니다. 내용 오류로 확정한 결과가 아닙니다. 다음 확인: 원문 페이지와 인용을 대조해 오타·설명 혼합·미지원 표를 구분하세요. 확인 전에는 통과로 세지 않습니다.
- **실패 확인** required_skill_reads: 필수 문서 전체 읽기 누락: context/skills/skill-bundle/docs/agent-harness/PROJECT.md 다음 확인: 기존 읽기 누락을 그대로 유지하고 문서 전달 절차를 확인하세요.

AI 원문 대조 메모 — 사람 검토 전:

- 인용 2 / changed_source_word_or_unit: p16 교환교류생을 교환학교류생으로 바꿨다. 제외 대상 명칭의 직접 인용 불일치다.
- 인용 5 / changed_source_word_or_unit: p16 인증받은 학생을 인증한 학생으로 바꿨다. 뜻이 유사해도 직접 인용과는 다르다.

</details>

<details><summary>CS-2026-2-020 / A — 응답 생성 완료 · 인용 확인됨</summary>

기존 run 상태: error. 정답값: pass. Skill 읽기: not_requested. 사람 검토: 대기.


</details>

<details><summary>CS-2026-2-020 / B — 응답 생성 완료 · 인용 자동 검증 불가</summary>

기존 run 상태: error. 정답값: pass. Skill 읽기: not_requested. 사람 검토: 대기.

- **자동 검증 불가** citation_2:quote_unverified: 문구나 표 관계를 현재 검사 범위에서 확인하지 못했습니다. 내용 오류로 확정한 결과가 아닙니다. 다음 확인: 원문 페이지와 인용을 대조해 오타·설명 혼합·미지원 표를 구분하세요. 확인 전에는 통과로 세지 않습니다.

AI 원문 대조 메모 — 사람 검토 전:

- 인용 3 / table_relationship_unhandled: p53 균형교양 표의 학점 합계는 6이다. 현재 영역→과목→학점 문법은 합계 행을 지원하지 않는다.

</details>

<details><summary>CS-2026-2-020 / C — 응답 생성 완료 · 인용 확인됨</summary>

기존 run 상태: error. 정답값: pass. Skill 읽기: pass. 사람 검토: 대기.


</details>

<details><summary>OPS-2026-2-001 / A — 응답 생성 완료 · 인용 자동 검증 불가</summary>

기존 run 상태: error. 정답값: pass. Skill 읽기: not_requested. 사람 검토: 대기.

- **자동 검증 불가** citation_0:quote_unverified: 문구나 표 관계를 현재 검사 범위에서 확인하지 못했습니다. 내용 오류로 확정한 결과가 아닙니다. 다음 확인: 원문 페이지와 인용을 대조해 오타·설명 혼합·미지원 표를 구분하세요. 확인 전에는 통과로 세지 않습니다.
- **자동 검증 불가** citation_1:quote_unverified: 문구나 표 관계를 현재 검사 범위에서 확인하지 못했습니다. 내용 오류로 확정한 결과가 아닙니다. 다음 확인: 원문 페이지와 인용을 대조해 오타·설명 혼합·미지원 표를 구분하세요. 확인 전에는 통과로 세지 않습니다.

AI 원문 대조 메모 — 사람 검토 전:

- 인용 1 / table_relationship_unhandled: p60 인공지능 열의 기초미적분학 행은 1-1이다. 행·열 교차 표 색인이 없다.
- 인용 2 / table_relationship_unhandled: p60 인공지능 열의 학점 합계는 9이다. 합계 행·학과 열 교차 조회는 미지원이다.

</details>

<details><summary>OPS-2026-2-001 / B — 응답 생성 완료 · 인용 자동 검증 불가</summary>

기존 run 상태: error. 정답값: pass. Skill 읽기: not_requested. 사람 검토: 대기.

- **자동 검증 불가** citation_0:quote_unverified: 문구나 표 관계를 현재 검사 범위에서 확인하지 못했습니다. 내용 오류로 확정한 결과가 아닙니다. 다음 확인: 원문 페이지와 인용을 대조해 오타·설명 혼합·미지원 표를 구분하세요. 확인 전에는 통과로 세지 않습니다.
- **자동 검증 불가** citation_1:quote_unverified: 문구나 표 관계를 현재 검사 범위에서 확인하지 못했습니다. 내용 오류로 확정한 결과가 아닙니다. 다음 확인: 원문 페이지와 인용을 대조해 오타·설명 혼합·미지원 표를 구분하세요. 확인 전에는 통과로 세지 않습니다.

AI 원문 대조 메모 — 사람 검토 전:

- 인용 1 / table_quote_with_added_explanation: p60 기초미적분학 3학점·인공지능 1-1은 맞다. 인용 안의 열:은 원문에 없는 설명이다.
- 인용 2 / table_quote_with_added_explanation: p60 인공지능 합계 9는 맞지만 열:이라는 설명을 인용에 추가했다.

</details>

<details><summary>OPS-2026-2-001 / C — 응답 생성 완료 · 인용 자동 검증 불가</summary>

기존 run 상태: error. 정답값: pass. Skill 읽기: fail. 사람 검토: 대기.

- **자동 검증 불가** citation_0:quote_unverified: 문구나 표 관계를 현재 검사 범위에서 확인하지 못했습니다. 내용 오류로 확정한 결과가 아닙니다. 다음 확인: 원문 페이지와 인용을 대조해 오타·설명 혼합·미지원 표를 구분하세요. 확인 전에는 통과로 세지 않습니다.
- **자동 검증 불가** citation_1:quote_unverified: 문구나 표 관계를 현재 검사 범위에서 확인하지 못했습니다. 내용 오류로 확정한 결과가 아닙니다. 다음 확인: 원문 페이지와 인용을 대조해 오타·설명 혼합·미지원 표를 구분하세요. 확인 전에는 통과로 세지 않습니다.
- **실패 확인** required_skill_reads: 필수 문서 전체 읽기 누락: context/skills/skill-bundle/docs/agent-harness/PROJECT.md 다음 확인: 기존 읽기 누락을 그대로 유지하고 문서 전달 절차를 확인하세요.

AI 원문 대조 메모 — 사람 검토 전:

- 인용 1 / table_relationship_unhandled: p60 기초미적분학→3→인공지능 열의 1-1은 맞다. 행·열 교차 표 색인이 없다.
- 인용 2 / table_relationship_unhandled: p60 인공지능 열의 학점 합계는 9이다. 합계 행·학과 열 교차 조회는 미지원이다.

</details>
