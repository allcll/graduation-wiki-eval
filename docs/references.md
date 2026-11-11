# 참고 자료

기업이 직접 공개한 평가 운영 사례에서 이 프로젝트에 필요한 방법을 골랐다. 평가 대상과 규모가 다르므로 도구·표본 수·통과 기준을 그대로 옮기지 않았다. 아래 자료는 ALLCLL 평가 결과를 검증하거나 인증한 자료가 아니다.

## 토스 — Toss Benchmark

[리더보드 1등 LLM, 토스에서도 1등일까? — Toss Benchmark 구축기](https://toss.tech/article/53109) · 2026-09-16

실제 업무와 운영 설정에 맞춰 모델을 평가하고, 도메인 지식과 정책 준수를 구분한다. 평가 구성에 참고한 업무는 다른 업무 성능과의 관계를 확인하는 분석에서 제외한다.

이 프로젝트에서는 정책 적용과 작업 절차를 따로 검토하고, 개발에 사용한 사례와 최종 평가 사례를 분리한다. A/B/C로 WIKI·Skill의 효과를 비교하는 설계는 이 프로젝트에서 정한 것이다. 토스의 `avg@4`는 객관식 정답 위치를 바꾸는 방식이므로 자유서술 응답의 반복 성공률로 사용하지 않는다.

## GitLab — Duo

[Developing GitLab Duo: How we validate and test AI models at scale](https://about.gitlab.com/blog/developing-gitlab-duo-how-we-validate-and-test-ai-models-at-scale/) · 2024-05-09

예상 운영 입력을 대표하는 질문·정답 라이브러리로 기준선을 만들고, 개선할 영역의 작은 평가와 다른 영역을 확인하는 회귀 평가를 함께 수행한다. 해당 라이브러리를 실제 고객 로그로만 구성했다고 해석하지 않는다.

이 프로젝트에서도 수정한 사례의 개선과 기존 사례의 악화를 함께 기록한다. 소규모 개발용 검사와 별도 최종 평가를 나누되, 공개되지 않은 GitLab의 내부 수치를 통과 기준으로 삼지 않는다.

## Shopify — Sidekick

[Sidekick's continual learning loop](https://shopify.engineering/sidekicks-continual-learning-loop) · 2026-08-05

전문가 사이의 판정 일치를 확인하고 LLM 채점기를 보정하는 절차를 설명한다. 의도적으로 응답 품질을 낮춰 관련 평가 항목이 그 변화를 감지하는지도 확인한다.

이 프로젝트에서는 사람의 근거 검토와 답변 전체 검토를 분리하고, 채점기에 잘못된 값·대상·근거를 넣는 테스트를 둔다. LLM 채점기나 자동 프롬프트 최적화까지 구현했다는 뜻은 아니다. 사람 검토가 한 명뿐인 경우 평가자 간 일치도를 측정했다고 표시하지 않는다.

## Amazon Ring — 고객 지원 지식 기반

[How Ring scales global customer support with Amazon Bedrock Knowledge Bases](https://aws.amazon.com/blogs/machine-learning/how-ring-scales-global-customer-support-with-amazon-bedrock-knowledge-bases/) · 2026-03-30

Ring 엔지니어가 공동 작성한 사례다. 지식 버전별 검색·응답 품질을 평가하고, 검증한 지식을 운영에 반영하며 지역별 결과와 이전 버전 복구 경로를 관리한다.

이 프로젝트에서는 지식 변경도 재평가 대상으로 보고 원문·WIKI·Skill 버전을 기록한다. Ring의 `Golden Data Source`는 운영에 사용할 승인된 지식 콘텐츠를 뜻하며, 사람이 정답을 붙인 평가셋과는 다르다. 이 프로젝트는 Ring의 RAG 인프라나 자동 승격 절차를 복제하지 않는다.
