"""Offline evaluation of imported runs, with explicit plans and human reviews.

Hashes detect stale or inconsistent records, not fabricated provenance. This
module does not execute models, authenticate reviewers, or approve deployment.
"""

import copy
import hashlib
import json
import math
import re
from collections import Counter
from pathlib import Path

VERSION = "allcll-offline-v1"
PLAN_SCHEMA = "allcll-plan-v1"
VERSION_KEYS = frozenset({
    "model", "model_config", "prompt", "source", "code", "data", "wiki",
    "skill", "dataset", "tools", "runtime", "harness",
})
NOTICE = "Project-defined pilot gate; not enterprise certification or statistical proof."
VERDICTS = ("pass", "fail", "pending")
METRICS = ("elapsed_ms", "input_tokens", "output_tokens")


class InputError(ValueError):
    """An input cannot safely be interpreted as an evaluation record."""


def require(ok, message):
    if not ok:
        raise InputError(message)


def nonempty(value):
    return isinstance(value, str) and bool(value.strip())


def _json_value(value, path="value"):
    """Reject non-JSON values even when called directly rather than through IO."""
    if value is None or type(value) in (str, bool, int):
        return
    if type(value) is float:
        require(math.isfinite(value), path + ": nonfinite JSON number")
    elif isinstance(value, list):
        for index, item in enumerate(value):
            _json_value(item, f"{path}[{index}]")
    elif isinstance(value, dict):
        for key, item in value.items():
            require(isinstance(key, str), path + ": JSON object keys must be strings")
            _json_value(item, path + "." + key)
    else:
        raise InputError(path + ": unsupported JSON type " + type(value).__name__)


def digest(value):
    _json_value(value)
    encoded = json.dumps(value, sort_keys=True, ensure_ascii=False,
                         separators=(",", ":"), allow_nan=False)
    return "sha256:" + hashlib.sha256(encoded.encode()).hexdigest()


def _is_digest(value):
    return isinstance(value, str) and re.fullmatch(r"sha256:[0-9a-f]{64}", value) is not None


def dataset_hash(cases):
    require(isinstance(cases, list), "Cases must be a JSON array")
    require(all(isinstance(c, dict) and nonempty(c.get("id")) for c in cases),
            "Dataset hashing requires cases with string IDs")
    return digest(sorted(cases, key=lambda case: case["id"]))


def _unique_object(pairs):
    result = {}
    for key, value in pairs:
        require(key not in result, "Duplicate JSON key: " + key)
        result[key] = value
    return result


def _reject_constant(value):
    raise InputError("Nonfinite JSON: " + value)


def _decode(text):
    try:
        value = json.loads(text, parse_constant=_reject_constant,
                           object_pairs_hook=_unique_object)
    except json.JSONDecodeError as exc:
        raise InputError(str(exc)) from exc
    _json_value(value)  # Also catches overflow such as 1e999.
    return value


def read_json(path):
    return _decode(Path(path).read_text(encoding="utf-8"))


def read_records(path):
    if not path:
        return []
    text = Path(path).read_text(encoding="utf-8")
    records = ([_decode(line) for line in text.splitlines() if line.strip()]
               if str(path).endswith(".jsonl") else _decode(text))
    require(isinstance(records, list), "Input must be a JSON array or JSONL records")
    return records


def write_records(path, records):
    require(isinstance(records, list), "Records must be a JSON array")
    _json_value(records)
    text = "".join(json.dumps(record, ensure_ascii=False, allow_nan=False) + "\n"
                   for record in records)
    Path(path).write_text(text, encoding="utf-8")


def validate_cases(cases):
    require(isinstance(cases, list) and bool(cases), "At least one case in a JSON array is required")
    _json_value(cases, "cases")
    ids, families = set(), {}
    for case in cases:
        require(isinstance(case, dict), "Each case must be an object")
        cid = case.get("id")
        require(nonempty(cid) and cid not in ids, "Case IDs must be unique nonempty strings")
        ids.add(cid)
        require(nonempty(case.get("family")), cid + ": family required")
        require(case.get("split") in ("dev", "holdout"), cid + ": split must be dev or holdout")
        family, split = case["family"], case["split"]
        require(family not in families or families[family] == split,
                "Family leakage across dev/holdout: " + family)
        families[family] = split
        require(case.get("origin") in ("real", "synthetic"), cid + ": origin required")
        require(case.get("review_status") in ("verified", "draft"), cid + ": review_status required")
        require(type(case.get("independent_reference")) is bool,
                cid + ": independent_reference must be boolean")
        if case["review_status"] == "verified":
            require(nonempty(case.get("oracle_reviewer")), cid + ": verified oracle requires reviewer")
        require(nonempty(case.get("question")), cid + ": question required")
        expected = case.get("expected")
        require(isinstance(expected, dict) and expected.get("action") in ("answer", "clarify", "escalate"),
                cid + ": expected action invalid")
        require(isinstance(expected.get("facts"), dict), cid + ": expected facts must be object")
        sources = case.get("sources")
        require(isinstance(sources, list) and bool(sources), cid + ": source provenance required")
        source_ids = set()
        for source in sources:
            require(isinstance(source, dict), cid + ": source must be object")
            require(all(nonempty(source.get(key)) for key in ("id", "version", "locator", "excerpt")),
                    cid + ": incomplete source provenance")
            require(source["id"] not in source_ids, cid + ": duplicate source id")
            source_ids.add(source["id"])
            require(type(source.get("authoritative")) is bool, cid + ": authoritative must be boolean")
    return {case["id"]: case for case in cases}


def _settings(conditions, repeats):
    require(isinstance(conditions, (list, tuple)) and bool(conditions)
            and all(isinstance(c, str) and c in ("A", "B", "C") for c in conditions),
            "Conditions must be unique A/B/C")
    require(len(set(conditions)) == len(conditions), "Conditions must be unique A/B/C")
    require(type(repeats) is int and repeats > 0, "Repeats must be positive integer")
    return sorted(conditions), repeats


def make_plan(cases, conditions=("A", "B", "C"), repeats=1):
    """Freeze the full intended dataset and slots before collecting responses."""
    validate_cases(cases)
    conditions, repeats = _settings(conditions, repeats)
    return {"schema": PLAN_SCHEMA, "dataset_sha256": dataset_hash(cases),
            "conditions": conditions, "repeats": repeats,
            "cases": [{"case_id": case["id"], "case_sha256": digest(case), "split": case["split"]}
                      for case in sorted(cases, key=lambda case: case["id"])]}


def _validate_plan_shape(plan):
    require(isinstance(plan, dict), "Plan must be an object")
    _json_value(plan, "plan")
    require(set(plan) == {"schema", "dataset_sha256", "conditions", "repeats", "cases"},
            "Plan fields are incomplete or unsupported")
    require(plan["schema"] == PLAN_SCHEMA, "Unsupported plan schema")
    require(_is_digest(plan["dataset_sha256"]), "Invalid plan dataset hash")
    conditions, repeats = _settings(plan["conditions"], plan["repeats"])
    require(plan["conditions"] == conditions, "Plan conditions must be canonical")
    require(isinstance(plan["cases"], list) and bool(plan["cases"]), "Plan requires cases")
    seen = set()
    for case in plan["cases"]:
        require(isinstance(case, dict) and set(case) == {"case_id", "case_sha256", "split"},
                "Invalid planned case")
        cid = case["case_id"]
        require(nonempty(cid) and cid not in seen, "Planned case IDs must be unique strings")
        seen.add(cid)
        require(case["split"] in ("dev", "holdout") and _is_digest(case["case_sha256"]),
                "Invalid planned case split or hash")
    require([c["case_id"] for c in plan["cases"]] == sorted(seen), "Planned cases must be canonical")
    return conditions, repeats


def validate_plan(plan, cases):
    conditions, repeats = _validate_plan_shape(plan)
    require(digest(plan) == digest(make_plan(cases, conditions, repeats)),
            "Plan does not match the complete cases, hashes, or splits")
    return plan


def _validate_versions(versions, dataset):
    require(isinstance(versions, dict) and VERSION_KEYS <= versions.keys()
            and all(nonempty(value) for value in versions.values()),
            "Complete string version metadata required")
    require(versions["dataset"] == dataset, "Dataset hash mismatch")
    require(versions["harness"] == VERSION, "Unsupported harness version")


def validate_runs(runs, cases, conditions, repeats):
    by_id = validate_cases(cases)
    conditions, repeats = _settings(conditions, repeats)
    require(isinstance(runs, list), "Runs must be a JSON array")
    _json_value(runs, "runs")
    dataset = dataset_hash(cases)
    slots, run_ids = {}, set()
    for run in runs:
        require(isinstance(run, dict), "Run must be object")
        rid = run.get("run_id")
        require(nonempty(rid) and rid not in run_ids, "Run IDs must be unique nonempty strings")
        run_ids.add(rid)
        cid, condition, repeat = run.get("case_id"), run.get("condition"), run.get("repeat")
        require(nonempty(cid) and cid in by_id, rid + ": unknown case")
        require(isinstance(condition, str) and condition in conditions, rid + ": unknown condition")
        require(type(repeat) is int and 1 <= repeat <= repeats, rid + ": repeat out of range")
        key = (cid, condition, repeat)
        require(key not in slots, "Duplicate run slot: " + str(key))
        require(run.get("execution") in ("real", "synthetic"), rid + ": execution must be real or synthetic")
        require(run.get("status") in ("ok", "error"), rid + ": status must be ok or error")
        require(run.get("case_sha256") == digest(by_id[cid]), rid + ": case hash mismatch")
        _validate_versions(run.get("versions"), dataset)
        require(nonempty(run.get("started_at")), rid + ": started_at required")
        if run["status"] == "ok":
            require(isinstance(run.get("output"), dict), rid + ": output object required")
            require(nonempty(run["output"].get("answer_text")),
                    rid + ": complete answer_text required for human review")
            require(run.get("output_sha256") == digest(run["output"]), rid + ": output hash mismatch")
        else:
            require(nonempty(run.get("error")), rid + ": error description required")
        for metric in METRICS:
            value = run.get(metric)
            require(value is None or (type(value) in (int, float) and 0 <= value < float("inf")),
                    rid + ": invalid " + metric)
        slots[key] = run
    return slots


def validate_reviews(reviews, runs):
    require(isinstance(reviews, list), "Reviews must be a JSON array")
    require(isinstance(runs, list), "Runs must be a JSON array")
    _json_value(reviews, "reviews")
    run_map = {}
    for run in runs:
        require(isinstance(run, dict) and nonempty(run.get("run_id")), "Invalid reviewed run")
        require(run["run_id"] not in run_map, "Duplicate reviewed run ID")
        run_map[run["run_id"]] = run
    result = {}
    for review in reviews:
        require(isinstance(review, dict), "Review must be object")
        rid = review.get("run_id")
        require(nonempty(rid) and rid in run_map and rid not in result,
                "Review must reference one unique known run")
        run = run_map[rid]
        require(run.get("status") == "ok", rid + ": cannot review an error output")
        require(review.get("reviewer_kind") == "human" and nonempty(review.get("reviewer_id")),
                rid + ": separate human reviewer attestation required")
        for field in ("evidence_verdict", "answer_verdict"):
            require(review.get(field) in VERDICTS, rid + ": invalid " + field)
        require(all(nonempty(review.get(key)) for key in ("reviewed_at", "rationale")),
                rid + ": review date and rationale required")
        for key in ("case_sha256", "output_sha256"):
            require(_is_digest(run.get(key)) and review.get(key) == run[key], rid + ": stale review " + key)
        result[rid] = review
    return result


def objective_details(output, expected):
    """Explain exact structured differences without judging the answer's prose."""
    require(isinstance(expected, dict) and isinstance(expected.get("facts"), dict)
            and expected.get("action") in ("answer", "clarify", "escalate"), "Invalid expected output")
    _json_value(expected)
    _json_value(output)
    if not isinstance(output, dict):
        return [{"field": "output", "reason": "expected_object", "actual": output}]
    details = []
    if output.get("action") != expected["action"]:
        details.append({"field": "action", "reason": "mismatch", "expected": expected["action"],
                        "actual": output.get("action"), "actual_present": "action" in output})
    actual = output.get("facts")
    if not isinstance(actual, dict):
        details.append({"field": "facts", "reason": "expected_object", "actual": actual})
        return details
    for key in sorted(set(expected["facts"]) | set(actual)):
        field = "facts." + key
        if key not in actual:
            details.append({"field": field, "reason": "missing_fact", "expected": expected["facts"][key]})
        elif key not in expected["facts"]:
            details.append({"field": field, "reason": "unexpected_fact", "actual": actual[key]})
        elif digest(actual[key]) != digest(expected["facts"][key]):
            details.append({"field": field, "reason": "mismatch", "expected": expected["facts"][key],
                            "actual": actual[key]})
    return details


def objective_pass(output, expected):
    return not objective_details(output, expected)


def oracle_ready(case):
    return (case["review_status"] == "verified" and case["independent_reference"]
            and all(source["authoritative"] for source in case["sources"]))


def row_success(row):
    return (not row["missing"] and not row["error"] and not row["unreviewed"]
            and row["oracle_ready"] and not row["synthetic"] and row["objective"] is True
            and row["evidence"] == "pass" and row["answer"] == "pass")


def row_failure(row):
    return row["objective"] is False or row["evidence"] == "fail" or row["answer"] == "fail"


def summarize(rows):
    counts = Counter({key: 0 for key in (
        "expected", "missing", "error", "unreviewed", "objective_pass", "objective_fail",
        "evidence_fail", "answer_fail", "reviewed_success", "synthetic",
    )})
    for row in rows:
        counts["expected"] += 1
        for key in ("missing", "error", "unreviewed", "synthetic"):
            counts[key] += int(row[key])
        counts["objective_pass"] += int(row["objective"] is True)
        counts["objective_fail"] += int(row["objective"] is False)
        counts["evidence_fail"] += int(row["evidence"] == "fail")
        counts["answer_fail"] += int(row["answer"] == "fail")
        counts["reviewed_success"] += int(row_success(row))
    counts["reviewed_success_rate"] = counts["reviewed_success"] / len(rows) if rows else None
    return dict(counts)


def _gates(rows, conditions):
    gates = {}
    synthetic = any(row["synthetic"] for row in rows)
    for condition in conditions:
        condition_rows = [row for row in rows if row["condition"] == condition]
        scoped = [row for row in condition_rows if row["split"] == "holdout"]
        stats, reasons = summarize(scoped), []
        if not scoped:
            reasons.append("no_holdout_cases")
        if synthetic:
            reasons.append("synthetic_present_in_batch")
        for name in ("missing", "error", "unreviewed", "synthetic"):
            if stats[name]:
                reasons.append(name)
        if any(not row["oracle_ready"] for row in scoped):
            reasons.append("unverified_or_nonindependent_or_non_authoritative_oracle")
        if len({digest(row["versions"]) for row in condition_rows if row["versions"] is not None}) > 1:
            reasons.append("mixed_versions_within_condition")
        failed = any(row_failure(row) and row["oracle_ready"] and not row["synthetic"] for row in scoped)
        if failed:
            reasons.append("confirmed_failure")
        elif any(row_failure(row) for row in scoped):
            reasons.append("unconfirmed_failure_against_draft_or_synthetic_oracle")
        gate = "INCONCLUSIVE" if synthetic else "FAIL" if failed else "INCONCLUSIVE" if reasons else "PASS"
        gates[condition] = {"gate": gate, "reasons": reasons, "holdout_counts": stats}
    return gates


def _metrics(rows, conditions):
    metrics = {}
    for condition in conditions:
        subset = [row for row in rows if row["condition"] == condition]
        metrics[condition] = {}
        for key in METRICS:
            values = [row["metrics"][key] for row in subset if row["metrics"][key] is not None]
            total = sum(values)
            require(not isinstance(total, float) or math.isfinite(total), "Nonfinite metric total: " + key)
            metrics[condition][key] = {"sum": total, "measured_runs": len(values), "expected_runs": len(subset)}
    return metrics


def evaluate(cases, runs, reviews=None, conditions=None, repeats=None, *, plan=None):
    """Score every planned slot; absent responses remain in the denominator.

    Explicit conditions/repeats preserve the original API. Passing a saved plan
    also rejects a changed dataset, split, condition list, or repetition count.
    """
    if plan is None:
        plan = make_plan(cases, ("A", "B", "C") if conditions is None else conditions,
                         1 if repeats is None else repeats)
    else:
        validate_plan(plan, cases)
        requested_conditions = plan["conditions"] if conditions is None else conditions
        requested_repeats = plan["repeats"] if repeats is None else repeats
        normalized, count = _settings(requested_conditions, requested_repeats)
        require(normalized == plan["conditions"] and count == plan["repeats"],
                "Conditions or repeats do not match the saved plan")
    conditions, repeats = plan["conditions"], plan["repeats"]
    slots = validate_runs(runs, cases, conditions, repeats)
    review_map = validate_reviews([] if reviews is None else reviews, runs)
    rows = []
    for case in sorted(cases, key=lambda case: case["id"]):
        for condition in conditions:
            for repeat in range(1, repeats + 1):
                run = slots.get((case["id"], condition, repeat))
                ok = bool(run and run["status"] == "ok")
                review = review_map.get(run["run_id"]) if ok else None
                details = objective_details(run["output"], case["expected"]) if ok else []
                rows.append({
                    "case_id": case["id"], "case_sha256": digest(case), "split": case["split"],
                    "condition": condition, "repeat": repeat, "run_id": run["run_id"] if run else None,
                    "missing": run is None, "error": bool(run and not ok),
                    "unreviewed": bool(ok and (not review or any(review[key] == "pending"
                                        for key in ("evidence_verdict", "answer_verdict")))),
                    "synthetic": case["origin"] == "synthetic" or bool(run and run["execution"] == "synthetic"),
                    "oracle_ready": oracle_ready(case), "versions": copy.deepcopy(run["versions"]) if run else None,
                    "objective": not details if ok else None, "objective_details": details,
                    "answer": review["answer_verdict"] if review else "pending",
                    "evidence": review["evidence_verdict"] if review else "pending",
                    "output_sha256": run["output_sha256"] if ok else None,
                    "review": copy.deepcopy(review),
                    "metrics": {key: run.get(key) if run else None for key in METRICS},
                })
    synthetic = any(row["synthetic"] for row in rows)
    report = {
        "harness": VERSION, "dataset_sha256": dataset_hash(cases), "policy": NOTICE,
        "plan": copy.deepcopy(plan), "plan_sha256": digest(plan),
        "label": ("SYNTHETIC PRESENT — NOT ACTUAL MODEL PERFORMANCE" if synthetic
                  else "Imported actual-run declarations; provenance not independently authenticated"),
        "gate_scope": "holdout only, per condition; not evidence of comparative improvement",
        "overall_counts": summarize(rows),
        "condition_counts": {condition: summarize([row for row in rows if row["condition"] == condition])
                             for condition in conditions},
        "gates": _gates(rows, conditions), "metrics": _metrics(rows, conditions), "rows": rows,
    }
    # No references to caller-owned inputs may change an already evaluated report.
    return copy.deepcopy(report)


def validate_report(report):
    """Check imported report structure and recompute summaries before comparing.

    This detects dropped slots, inconsistent verdicts, stale review bindings and
    edited summaries. Consistently fabricated inputs still require provenance
    review; unsigned JSON cannot authenticate a real execution or a human.
    """
    require(isinstance(report, dict), "Report must be an object")
    _json_value(report, "report")
    require(report.get("harness") == VERSION, "Incompatible report harness")
    plan = report.get("plan")
    conditions, repeats = _validate_plan_shape(plan)
    require(report.get("plan_sha256") == digest(plan), "Report plan hash mismatch")
    require(report.get("dataset_sha256") == plan["dataset_sha256"], "Report dataset differs from plan")
    planned_cases = {case["case_id"]: case for case in plan["cases"]}
    planned_slots = {(cid, condition, repeat) for cid in planned_cases
                     for condition in conditions for repeat in range(1, repeats + 1)}
    rows = report.get("rows")
    require(isinstance(rows, list), "Report rows must be an array")
    require(len(rows) == len(planned_slots), "Report rows do not cover the complete planned slots")
    seen, run_ids, readiness = set(), set(), {}
    for row in rows:
        require(isinstance(row, dict), "Report row must be an object")
        cid, condition, repeat = row.get("case_id"), row.get("condition"), row.get("repeat")
        require(nonempty(cid) and cid in planned_cases, "Unknown report case")
        require(isinstance(condition, str) and condition in conditions, "Unknown report condition")
        require(type(repeat) is int and 1 <= repeat <= repeats, "Invalid report repeat")
        slot = (cid, condition, repeat)
        require(slot not in seen, "Duplicate comparison slot")
        seen.add(slot)
        case = planned_cases[cid]
        require(row.get("split") == case["split"] and row.get("case_sha256") == case["case_sha256"],
                "Report case hash or split differs from plan")
        for field in ("missing", "error", "unreviewed", "synthetic", "oracle_ready"):
            require(type(row.get(field)) is bool, "Report row requires boolean " + field)
        require(cid not in readiness or readiness[cid] == row["oracle_ready"],
                "Inconsistent oracle readiness for the same case")
        readiness[cid] = row["oracle_ready"]
        require("objective" in row and (row["objective"] is None or type(row["objective"]) is bool),
                "Report objective must be boolean or null")
        require(row.get("answer") in VERDICTS and row.get("evidence") in VERDICTS,
                "Invalid report review verdict")
        details = row.get("objective_details")
        require(isinstance(details, list) and all(isinstance(item, dict)
                and nonempty(item.get("field")) and nonempty(item.get("reason")) for item in details),
                "Invalid objective diagnostic details")
        require("review" in row and "output_sha256" in row and "versions" in row and "run_id" in row,
                "Report row is missing provenance fields")
        metrics = row.get("metrics")
        require(isinstance(metrics, dict) and set(metrics) == set(METRICS), "Invalid row metrics")
        for key, value in metrics.items():
            require(value is None or (type(value) in (int, float) and 0 <= value < float("inf")),
                    "Invalid row metric " + key)
        if row["missing"]:
            require(row["run_id"] is None and row["versions"] is None and not row["error"]
                    and all(value is None for value in metrics.values()),
                    "Missing run cannot contain execution evidence")
        else:
            rid = row["run_id"]
            require(nonempty(rid) and rid not in run_ids, "Report run IDs must be unique strings")
            run_ids.add(rid)
            _validate_versions(row["versions"], report["dataset_sha256"])
        if row["missing"] or row["error"]:
            require(row["objective"] is None and not details and not row["unreviewed"]
                    and row["answer"] == row["evidence"] == "pending"
                    and row["review"] is None and row["output_sha256"] is None,
                    "Missing/error run cannot carry a completed judgment")
        else:
            require(type(row["objective"]) is bool and row["objective"] == (not details),
                    "Objective verdict disagrees with diagnostics")
            require(_is_digest(row["output_sha256"]), "Invalid report output hash")
            review = row["review"]
            if review is None:
                require(row["answer"] == row["evidence"] == "pending", "Verdict without human review")
            else:
                validate_reviews([review], [{"run_id": row["run_id"], "status": "ok",
                    "case_sha256": row["case_sha256"], "output_sha256": row["output_sha256"]}])
                require(row["answer"] == review["answer_verdict"]
                        and row["evidence"] == review["evidence_verdict"],
                        "Report verdict differs from bound human review")
            require(row["unreviewed"] == (row["answer"] == "pending" or row["evidence"] == "pending"),
                    "Report review completeness is inconsistent")
    require(seen == planned_slots, "Report does not match planned slots")
    derived = {
        "overall_counts": summarize(rows),
        "condition_counts": {condition: summarize([row for row in rows if row["condition"] == condition])
                             for condition in conditions},
        "gates": _gates(rows, conditions), "metrics": _metrics(rows, conditions),
    }
    for field, expected in derived.items():
        require(field in report and digest(report[field]) == digest(expected),
                "Report " + field + " disagrees with its rows")
    return report


def compare_reports(baseline, candidate, condition="C", split="holdout"):
    """Matched v0/v1 diagnostics allowing only WIKI and Skill to differ."""
    require(isinstance(condition, str) and condition in ("A", "B", "C")
            and isinstance(split, str) and split in ("dev", "holdout"), "Invalid comparison scope")
    validate_report(baseline)
    validate_report(candidate)
    reasons, transitions = [], []
    if baseline["dataset_sha256"] != candidate["dataset_sha256"]:
        reasons.append("different_datasets_or_rubrics")
    if baseline["plan_sha256"] != candidate["plan_sha256"]:
        reasons.append("different_evaluation_plans")

    def scoped(report):
        return {(row["case_id"], row["repeat"]): row for row in report["rows"]
                if row["condition"] == condition and row["split"] == split}

    left, right = scoped(baseline), scoped(candidate)
    if not left or set(left) != set(right):
        reasons.append("empty_or_unmatched_planned_slots")
    for key in sorted(set(left) | set(right)):
        a, b = left.get(key), right.get(key)
        if a is None or b is None:
            continue
        if any(row[field] for row in (a, b) for field in ("missing", "error", "unreviewed", "synthetic")) \
                or not all(row["oracle_ready"] for row in (a, b)):
            reasons.append("incomplete_synthetic_or_unverified_pairs")
            continue
        # Additional version metadata is stable too; no unlisted confound may
        # silently bypass the known mandatory version keys.
        stable = (set(a["versions"]) | set(b["versions"])) - {"wiki", "skill"}
        if a["case_sha256"] != b["case_sha256"] or any(
                a["versions"].get(field) != b["versions"].get(field) for field in stable):
            reasons.append("confounded_pair_versions")
            continue
        was, now = row_success(a), row_success(b)
        transition = ("improved" if not was and now else "regressed" if was and not now
                      else "unchanged_pass" if now else "unchanged_fail")
        transitions.append({"case_id": key[0], "repeat": key[1], "transition": transition})
    for report in (baseline, candidate):
        if any(row["synthetic"] for row in report["rows"]):
            reasons.append("synthetic_present_in_batch")
        # Keep the same version scope as evaluate's per-condition batch gate.
        versions = {digest(row["versions"]) for row in report["rows"]
                    if row["condition"] == condition and row["versions"] is not None}
        if len(versions) > 1:
            reasons.append("mixed_versions_within_report")
    counts = Counter({key: 0 for key in ("improved", "regressed", "unchanged_pass", "unchanged_fail")})
    counts.update(item["transition"] for item in transitions)
    return {
        "status": "INCONCLUSIVE" if reasons else "COMPARABLE", "condition": condition, "split": split,
        "label": "Matched diagnostic comparison; NOT a deployment approval or significance test",
        "planned_pairs": len(set(left) | set(right)), "comparable_pairs": len(transitions),
        "reasons": sorted(set(reasons)), "counts": dict(counts), "transitions": transitions,
    }
