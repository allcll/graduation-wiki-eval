"""Command-line entry points; model calls only happen through the run command."""

import argparse
import json
from pathlib import Path
import sys

from . import __version__, core
from .reporting import write_json, write_report
from .runner import prepare, run_plan


def _plan(path):
    plan = core.read_json(path)
    if not isinstance(plan, dict):
        raise ValueError("Plan must be a JSON object")
    return plan.get("evaluation_plan", plan)


def _new_json(path, value):
    path = Path(path)
    if path.exists():
        raise ValueError(f"Refusing to overwrite {path}; use a new output path")
    write_json(path, value)


def _prepare(cases_path, config_path, out):
    config = core.read_json(config_path)
    if not isinstance(config, dict):
        raise ValueError("Run config must be a JSON object")
    context_root = Path(config.get("context_root", "."))
    if not context_root.is_absolute():
        context_root = Path(config_path).resolve().parent / context_root
    config["context_root"] = str(context_root)
    return prepare(core.read_records(cases_path), config, out)


def demo(out):
    """Run a fixed response adapter against fictional rules, without an LLM."""
    out = Path(out)
    if out.exists():
        raise ValueError("Demo output already exists; choose a new directory")
    sample = Path(__file__).parent / "sample"
    cases = core.read_records(sample / "cases.jsonl")
    config = {
        "context_root": str(sample / "context"), "sources": ["original.md"],
        "wiki": ["wiki.md"], "skills": ["SKILL.md"], "conditions": ["A", "B", "C"],
        "repeats": 1, "timeout": 10, "execution": "synthetic", "model": "fixture-no-model",
        "model_config": "none", "prompt": "sample-output-v1", "code": "none", "data": "fictional-v1",
        "tools": "fixture-stdio", "runtime": "python-stdlib",
        "instructions": "답변 가능하면 facts는 remaining_credits 정수만 담는다. 추가 질문이면 required_fields 배열, 근거 충돌이면 reason: source_conflict만 담는다. 이 형식은 모든 질문과 조건에 동일하다.",
    }
    manifest = prepare(cases, config, out / "experiment")
    runs = run_plan(out / "experiment" / "plan.json", [sys.executable, str(Path(__file__).with_name("fixture_agent.py"))])
    report = core.evaluate(cases, runs, plan=manifest["evaluation_plan"])
    core.write_records(out / "cases.jsonl", cases)
    write_report(out / "report.json", report)
    return report


def _parser():
    parser = argparse.ArgumentParser(prog="grad-eval", description="졸업요건 WIKI·Skill 평가 실행과 회귀 비교")
    parser.add_argument("--version", action="version", version=__version__)
    sub = parser.add_subparsers(dest="command", required=True)

    check = sub.add_parser("validate", help="사례와 규칙군 분할 검사")
    check.add_argument("--cases", type=Path, required=True)
    plan = sub.add_parser("plan", help="외부 실행 기록을 위한 평가 계획 고정")
    plan.add_argument("--cases", type=Path, required=True)
    plan.add_argument("--conditions", nargs="+", choices=("A", "B", "C"), default=["A", "B", "C"])
    plan.add_argument("--repeats", type=int, default=1)
    plan.add_argument("--out", type=Path, required=True)
    prep = sub.add_parser("prepare", help="조건별 자료 복사와 실행 계획 고정")
    prep.add_argument("--cases", type=Path, required=True)
    prep.add_argument("--config", type=Path, required=True)
    prep.add_argument("--out", type=Path, required=True)
    run = sub.add_parser("run", help="명시한 외부 어댑터 실행; 모델에 따라 비용 발생")
    run.add_argument("--plan", type=Path, required=True)
    run.add_argument("adapter", nargs=argparse.REMAINDER, help="-- 뒤에 실행 명령과 인수")
    review = sub.add_parser("review-template", help="해시로 응답과 연결된 미완료 사람 검토 양식")
    review.add_argument("--runs", type=Path, required=True)
    review.add_argument("--out", type=Path, required=True)
    report = sub.add_parser("report", help="계획한 모든 실행을 채점하고 JSON/Markdown 출력")
    report.add_argument("--cases", type=Path, required=True)
    report.add_argument("--runs", type=Path, required=True)
    report.add_argument("--reviews", type=Path)
    report.add_argument("--plan", type=Path, required=True)
    report.add_argument("--out", type=Path, required=True)
    report.add_argument("--check", action="store_true", help="모든 조건 PASS일 때만 종료 코드 0")
    compare = sub.add_parser("compare", help="같은 조건의 WIKI·Skill 변경 전후 비교")
    compare.add_argument("--baseline", type=Path, required=True)
    compare.add_argument("--candidate", type=Path, required=True)
    compare.add_argument("--condition", choices=("A", "B", "C"), default="C")
    compare.add_argument("--split", choices=("dev", "holdout"), default="holdout")
    compare.add_argument("--out", type=Path, required=True)
    sample = sub.add_parser("demo", help="모델 호출 없는 합성 예제 실행")
    sample.add_argument("--out", type=Path, default=Path("artifacts/demo"))
    return parser


def main(argv=None):
    args = _parser().parse_args(argv)
    protected = {getattr(args, key).resolve() for key in ("cases", "runs", "reviews", "plan", "baseline", "candidate")
                 if isinstance(getattr(args, key, None), Path)}
    try:
        if args.command in ("report", "compare") and args.out.resolve() in protected:
            raise ValueError("Report output must not overwrite an input file")
        if args.command == "validate":
            cases = core.read_records(args.cases)
            core.validate_cases(cases)
            result = {"valid": True, "cases": len(cases), "dataset_sha256": core.dataset_hash(cases)}
        elif args.command == "plan":
            result = core.make_plan(core.read_records(args.cases), args.conditions, args.repeats)
            _new_json(args.out, result)
        elif args.command == "prepare":
            result = _prepare(args.cases, args.config, args.out)
            result = {"plan": str(args.out / "plan.json"), "evaluation_plan": result["evaluation_plan"]}
        elif args.command == "run":
            command = args.adapter[1:] if args.adapter[:1] == ["--"] else args.adapter
            if not command:
                raise ValueError("An adapter command is required after --")
            runs = run_plan(args.plan, command)
            errors = sum(run["status"] == "error" for run in runs)
            result = {"runs": len(runs), "errors": errors, "path": str(args.plan.parent / "runs.jsonl")}
            print(json.dumps(result, ensure_ascii=False, indent=2))
            return 1 if errors else 0
        elif args.command == "review-template":
            result = []
            for run in core.read_records(args.runs):
                if run["status"] == "ok":
                    result.append({"run_id": run["run_id"], "case_sha256": run["case_sha256"],
                                   "output_sha256": run["output_sha256"], "reviewer_kind": "human",
                                   "reviewer_id": "", "reviewed_at": "", "rationale": "",
                                   "answer_verdict": "pending", "evidence_verdict": "pending"})
            if args.out.exists():
                raise ValueError("Review output already exists; refusing to overwrite human reviews")
            args.out.parent.mkdir(parents=True, exist_ok=True)
            core.write_records(args.out, result)
            result = {"templates": len(result), "path": str(args.out), "status": "requires human review"}
        elif args.command == "report":
            result = core.evaluate(core.read_records(args.cases), core.read_records(args.runs),
                                   core.read_records(args.reviews) if args.reviews else [], plan=_plan(args.plan))
            write_report(args.out, result)
        elif args.command == "compare":
            result = core.compare_reports(core.read_json(args.baseline), core.read_json(args.candidate), args.condition, args.split)
            write_report(args.out, result)
        else:
            result = demo(args.out)
        if "gates" in result:
            summary = {"report": str(args.out / "report.json") if args.command == "demo" else str(args.out),
                       "label": result["label"], "counts": result["overall_counts"],
                       "gates": {key: value["gate"] for key, value in result["gates"].items()}}
        else:
            summary = result
        print(json.dumps(summary, ensure_ascii=False, indent=2))
        if getattr(args, "check", False):
            return 0 if all(g["gate"] == "PASS" for g in result["gates"].values()) else 1
        return 0
    except (ValueError, TypeError, KeyError, OSError) as exc:
        failure = {"gate": "INCONCLUSIVE", "input_error": str(exc)}
        # Replace stale reports, but never overwrite plans, transcripts, or reviews.
        if args.command in ("report", "compare") and args.out.suffix == ".json" and args.out.resolve() not in protected:
            try:
                write_report(args.out, failure)
            except OSError as output_error:
                failure["output_error"] = str(output_error)
        print(json.dumps(failure, ensure_ascii=False), file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
