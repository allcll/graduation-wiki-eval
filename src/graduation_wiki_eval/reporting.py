"""Local JSON and Markdown reports. Do not publish model transcripts by default."""

import json
import os
import tempfile
from pathlib import Path


def write_json(path, value):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    text = json.dumps(value, ensure_ascii=False, indent=2, allow_nan=False) + "\n"
    with tempfile.NamedTemporaryFile(mode="w", encoding="utf-8", dir=path.parent, delete=False) as temp:
        temp.write(text)
        name = temp.name
    try:
        os.replace(name, path)
    finally:
        Path(name).unlink(missing_ok=True)


def markdown(report):
    if "input_error" in report:
        return "# 평가 미완료\n\n**INCONCLUSIVE**\n\n" + str(report["input_error"]) + "\n"
    if "gates" not in report:
        return "# 버전 비교\n\n```json\n" + json.dumps(report, ensure_ascii=False, indent=2) + "\n```\n"
    lines = ["# 평가 결과", "", "**" + report["label"] + "**", "",
             "품질 판정은 조건별 holdout 사례에 적용합니다. 자동 배포 승인이 아닙니다.", "",
             "| 조건 | 전체 계획 | 성공 | 누락 | 실행 오류 | 검토 대기 | holdout 판정 |",
             "| --- | ---: | ---: | ---: | ---: | ---: | --- |"]
    for condition, counts in report["condition_counts"].items():
        lines.append(f"| {condition} | {counts['expected']} | {counts['reviewed_success']} | {counts['missing']} | {counts['error']} | {counts['unreviewed']} | {report['gates'][condition]['gate']} |")
    lines += ["", "위 실행 건수는 dev와 holdout 합계입니다. 판정의 holdout 분모는 JSON 보고서에 따로 기록됩니다.", "", "## 판정 사유", ""]
    for condition, gate in report["gates"].items():
        lines.append(f"- {condition}: " + (", ".join(gate["reasons"]) or "holdout 필수 검사 통과"))
    lines += ["", "## 확인할 실행", ""]
    for row in report["rows"]:
        if row.get("objective") is False or row.get("evidence") == "fail" or row.get("answer") == "fail":
            details = json.dumps(row.get("objective_details", []), ensure_ascii=False)
            lines.append(f"- `{row['case_id']}` / {row['condition']} / {row['repeat']}: {details}; evidence={row['evidence']}, answer={row['answer']}")
    return "\n".join(lines) + "\n"


def write_report(path, report):
    path = Path(path)
    if path.suffix != ".json":
        raise ValueError("Report output must use a .json extension")
    write_json(path, report)
    path.with_suffix(".md").write_text(markdown(report), encoding="utf-8")
