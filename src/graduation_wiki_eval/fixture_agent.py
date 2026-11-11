"""Deterministic protocol example; no LLM is involved and no gold file is read."""

import json
import sys


def respond(request):
    inputs = request.get("inputs", {})
    if "admission_year" not in inputs:
        return {"action": "clarify", "facts": {"required_fields": ["admission_year"]},
                "answer_text": "[합성 예제] 적용 규정을 확인하려면 입학년도가 필요합니다.", "citations": []}
    if inputs.get("policy_conflict"):
        return {"action": "escalate", "facts": {"reason": "source_conflict"},
                "answer_text": "[합성 예제] 두 규정의 우선순위가 없어 필요한 학점을 확정할 수 없습니다.",
                "citations": ["sample-conflict"]}
    remaining = max(0, 120 - inputs["completed_credits"])
    return {"action": "answer", "facts": {"remaining_credits": remaining},
            "answer_text": f"[합성 예제] 가상 규정의 120학점 기준으로 {remaining}학점이 부족합니다.",
            "citations": ["sample-credits"]}


if __name__ == "__main__":
    print(json.dumps(respond(json.load(sys.stdin)), ensure_ascii=False))
