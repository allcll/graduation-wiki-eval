"""Manufactured control-flow tests; these are not model performance evidence."""

import copy
import json
import tempfile
import unittest
from pathlib import Path

from graduation_wiki_eval import core as ev


def records():
    """Simulate trusted declarations without pretending they are real reviews."""
    expectations = [
        {"action": "answer", "facts": {"remaining_badges": 2}},
        {"action": "clarify", "facts": {"required_fields": ["join_year"]}},
        {"action": "escalate", "facts": {"reason": "source_conflict"}},
    ]
    cases = [{
        "id": f"test-{index}", "family": f"family-{index}", "split": "holdout",
        "origin": "real", "review_status": "verified", "oracle_reviewer": "test-oracle",
        "independent_reference": True, "question": "Unit-test-only invented question",
        "expected": expected,
        "sources": [{"id": f"source-{index}", "version": "invented-v1", "locator": "test section",
                     "excerpt": "Invented for control-flow tests", "authoritative": True}],
    } for index, expected in enumerate(expectations)]
    runs, reviews = [], []
    for case in cases:
        output = {**copy.deepcopy(case["expected"]), "answer_text": "Unit-test-only answer"}
        run = {
            "run_id": case["id"] + "-C-1", "case_id": case["id"], "condition": "C", "repeat": 1,
            "execution": "real", "status": "ok", "started_at": "unit-test-only",
            "versions": {key: "test-v1" for key in ev.VERSION_KEYS},
            "case_sha256": ev.digest(case), "output": output, "output_sha256": ev.digest(output),
        }
        run["versions"].update(dataset=ev.dataset_hash(cases), harness=ev.VERSION)
        runs.append(run)
        reviews.append({
            "run_id": run["run_id"], "reviewer_kind": "human", "reviewer_id": "test-human-attestation",
            "reviewed_at": "unit-test-only", "rationale": "Manufactured review for testing only",
            "case_sha256": run["case_sha256"], "output_sha256": run["output_sha256"],
            "evidence_verdict": "pass", "answer_verdict": "pass",
        })
    return cases, runs, reviews


class FixtureCase(unittest.TestCase):
    def setUp(self):
        self.cases, self.runs, self.reviews = records()

    def report(self, reviews=None, repeats=1, plan=None):
        return ev.evaluate(self.cases, self.runs, self.reviews if reviews is None else reviews,
                           ("C",), repeats, plan=plan)

    def gate(self, report=None):
        return (self.report() if report is None else report)["gates"]["C"]["gate"]

    def refresh_cases(self):
        case_map = {case["id"]: case for case in self.cases}
        review_map = {review["run_id"]: review for review in self.reviews}
        for run in self.runs:
            run["case_sha256"] = ev.digest(case_map[run["case_id"]])
            run["versions"]["dataset"] = ev.dataset_hash(self.cases)
            if run["run_id"] in review_map:
                review_map[run["run_id"]]["case_sha256"] = run["case_sha256"]

    def refresh_output(self, index=0):
        self.runs[index]["output_sha256"] = ev.digest(self.runs[index]["output"])
        self.reviews[index]["output_sha256"] = self.runs[index]["output_sha256"]

class EvaluationTests(FixtureCase):
    def test_complete_attested_holdout_passes_with_saved_plan(self):
        plan = ev.make_plan(self.cases, ("C",), 1)
        report = ev.evaluate(self.cases, self.runs, self.reviews, plan=plan)
        self.assertEqual(self.gate(report), "PASS")
        self.assertEqual(report["overall_counts"]["reviewed_success_rate"], 1)
        self.assertEqual(report["plan_sha256"], ev.digest(plan))
        self.assertIs(ev.validate_report(report), report)

    def test_plan_does_not_shrink_to_observed_conditions_or_repeats(self):
        plan = ev.make_plan(self.cases, ("A", "B", "C"), 3)
        report = ev.evaluate(self.cases, self.runs, self.reviews, plan=plan)
        self.assertEqual(report["overall_counts"]["expected"], 27)
        self.assertEqual(report["overall_counts"]["missing"], 24)
        self.assertEqual({gate["gate"] for gate in report["gates"].values()}, {"INCONCLUSIVE"})
        for conditions, repeats in ((("C",), 3), (("A", "B", "C"), 1)):
            with self.subTest(conditions=conditions, repeats=repeats), self.assertRaises(ev.InputError):
                ev.evaluate(self.cases, self.runs, self.reviews, conditions, repeats, plan=plan)

    def test_saved_plan_rejects_omitted_cases_or_changed_split(self):
        plan = ev.make_plan(self.cases, ("C",), 1)
        with self.assertRaises(ev.InputError):
            ev.validate_plan(plan, self.cases[:-1])
        self.cases[0]["split"] = "dev"
        with self.assertRaises(ev.InputError):
            ev.validate_plan(plan, self.cases)

    def test_missing_and_error_keep_denominator_and_incurred_cost(self):
        self.runs.pop()
        self.reviews.pop()
        self.runs[0].update(status="error", error="runner timeout", elapsed_ms=400, input_tokens=20)
        self.reviews.pop(0)
        report = self.report()
        self.assertEqual(self.gate(report), "INCONCLUSIVE")
        self.assertEqual(report["overall_counts"]["expected"], 3)
        self.assertEqual(report["overall_counts"]["missing"], 1)
        self.assertEqual(report["overall_counts"]["error"], 1)
        self.assertAlmostEqual(report["overall_counts"]["reviewed_success_rate"], 1 / 3)
        self.assertEqual(report["metrics"]["C"]["elapsed_ms"],
                         {"sum": 400, "measured_runs": 1, "expected_runs": 3})
        ev.validate_report(report)

    def test_known_failure_overrides_other_pending_reviews(self):
        self.runs[0]["output"]["facts"]["remaining_badges"] = 999
        self.refresh_output()
        report = self.report(reviews=[])
        self.assertEqual(self.gate(report), "FAIL")
        self.assertIn("confirmed_failure", report["gates"]["C"]["reasons"])
        self.assertEqual(report["rows"][0]["objective_details"], [{
            "field": "facts.remaining_badges", "reason": "mismatch", "expected": 2, "actual": 999,
        }])

    def test_self_evaluation_does_not_replace_human_review(self):
        for index, run in enumerate(self.runs):
            run["output"].update(evidence_pass=True, answer_verdict="pass")
            self.refresh_output(index)
        report = self.report(reviews=[])
        self.assertEqual(self.gate(report), "INCONCLUSIVE")
        self.assertEqual(report["overall_counts"]["unreviewed"], 3)
        self.assertEqual(report["overall_counts"]["reviewed_success"], 0)

    def test_both_review_verdicts_required_and_pending_is_not_success(self):
        for field in ("answer_verdict", "evidence_verdict"):
            with self.subTest(field=field):
                self.reviews[0][field] = "pending"
                self.assertEqual(self.gate(), "INCONCLUSIVE")
                self.reviews[0][field] = "fail"
                self.assertEqual(self.gate(), "FAIL")
                del self.reviews[0][field]
                with self.assertRaises(ev.InputError):
                    self.report()
                self.reviews[0][field] = "pass"

    def test_full_answer_is_required_and_bound_to_review(self):
        self.runs[0]["output"]["answer_text"] = "A changed answer with a new contradiction"
        self.runs[0]["output_sha256"] = ev.digest(self.runs[0]["output"])
        with self.assertRaisesRegex(ev.InputError, "stale review"):
            self.report()
        del self.runs[0]["output"]["answer_text"]
        self.runs[0]["output_sha256"] = ev.digest(self.runs[0]["output"])
        with self.assertRaisesRegex(ev.InputError, "answer_text"):
            self.report(reviews=[])

    def test_draft_and_synthetic_wrong_answers_are_not_confirmed_failures(self):
        self.runs[0]["output"]["facts"]["remaining_badges"] = 999
        self.refresh_output()
        self.cases[0]["review_status"] = "draft"
        self.refresh_cases()
        self.assertEqual(self.gate(), "INCONCLUSIVE")
        self.cases[0]["review_status"] = "verified"
        self.cases[0]["origin"] = "synthetic"
        self.refresh_cases()
        self.assertEqual(self.gate(), "INCONCLUSIVE")
        self.cases[0]["origin"] = "real"
        self.refresh_cases()
        self.runs[0]["execution"] = "synthetic"
        self.assertEqual(self.gate(), "INCONCLUSIVE")

    def test_untrusted_oracle_cannot_contribute_reviewed_success(self):
        for key, value in (("review_status", "draft"), ("independent_reference", False)):
            with self.subTest(key=key):
                original = self.cases[0][key]
                self.cases[0][key] = value
                self.refresh_cases()
                report = self.report()
                self.assertEqual(self.gate(report), "INCONCLUSIVE")
                self.assertEqual(report["overall_counts"]["reviewed_success"], 2)
                self.cases[0][key] = original
        self.cases[0]["sources"][0]["authoritative"] = False
        self.refresh_cases()
        self.assertEqual(self.gate(), "INCONCLUSIVE")

    def test_dev_only_is_not_holdout_approval(self):
        for case in self.cases:
            case["split"] = "dev"
        self.refresh_cases()
        self.assertEqual(self.gate(), "INCONCLUSIVE")
        self.assertIn("no_holdout_cases", self.report()["gates"]["C"]["reasons"])

    def test_family_leakage_is_rejected(self):
        self.cases[1].update(family=self.cases[0]["family"], split="dev")
        with self.assertRaisesRegex(ev.InputError, "Family leakage"):
            ev.validate_cases(self.cases)

    def test_stale_case_dataset_output_or_review_hashes_rejected(self):
        for record, key in ((self.runs[0], "case_sha256"), (self.runs[0], "output_sha256"),
                            (self.runs[0]["versions"], "dataset"), (self.reviews[0], "case_sha256"),
                            (self.reviews[0], "output_sha256")):
            with self.subTest(key=key):
                old = record[key]
                record[key] = "stale"
                with self.assertRaises(ev.InputError):
                    self.report()
                record[key] = old

    def test_model_duplicate_or_orphan_review_rejected(self):
        self.reviews[0]["reviewer_kind"] = "model"
        with self.assertRaises(ev.InputError):
            self.report()
        self.reviews[0]["reviewer_kind"] = "human"
        self.reviews.append(copy.deepcopy(self.reviews[0]))
        with self.assertRaises(ev.InputError):
            self.report()
        self.reviews.pop()
        self.reviews[0]["run_id"] = "unknown"
        with self.assertRaises(ev.InputError):
            self.report()

    def test_duplicate_run_slot_is_rejected(self):
        self.runs.append({**self.runs[0], "run_id": "duplicate-slot"})
        with self.assertRaisesRegex(ev.InputError, "Duplicate run slot"):
            self.report()

    def test_mixed_versions_block_pass_and_missing_versions_rejected(self):
        self.runs[0]["versions"]["model"] = "other-model"
        self.assertEqual(self.gate(), "INCONCLUSIVE")
        for field in ev.VERSION_KEYS:
            with self.subTest(field=field):
                original = self.runs[0]["versions"].pop(field)
                with self.assertRaises(ev.InputError):
                    self.report()
                self.runs[0]["versions"][field] = original

    def test_unknown_cost_is_not_zero_observation(self):
        self.assertEqual(self.report()["metrics"]["C"]["input_tokens"],
                         {"sum": 0, "measured_runs": 0, "expected_runs": 3})

    def test_objective_diagnostics_preserve_missing_extra_and_typed_values(self):
        expected = {"action": "answer", "facts": {"needed": 1, "missing": 2}}
        output = {"action": "clarify", "facts": {"needed": True, "extra": 3}}
        details = ev.objective_details(output, expected)
        self.assertEqual({item["field"] for item in details},
                         {"action", "facts.needed", "facts.missing", "facts.extra"})
        self.assertFalse(ev.objective_pass(output, expected))
        self.assertFalse(ev.objective_pass({"action": "answer", "facts": {"x": 1.0}},
                                           {"action": "answer", "facts": {"x": 1}}))

    def test_report_is_detached_from_mutable_input_records(self):
        report = self.report()
        original = copy.deepcopy(report)
        self.runs[0]["versions"]["model"] = "changed-later"
        self.reviews[0]["answer_verdict"] = "fail"
        self.runs[0]["output"]["facts"]["remaining_badges"] = 999
        self.assertEqual(report, original)


class ComparisonTests(FixtureCase):
    def test_equal_totals_still_report_improvement_and_regression(self):
        self.reviews[0]["answer_verdict"] = "fail"
        baseline = self.report()
        self.reviews[0]["answer_verdict"] = "pass"
        self.reviews[1]["answer_verdict"] = "fail"
        for run in self.runs:
            run["versions"]["wiki"] = "wiki-v2"
        candidate = self.report()
        result = ev.compare_reports(baseline, candidate)
        self.assertEqual(result["status"], "COMPARABLE")
        self.assertEqual(result["counts"],
                         {"improved": 1, "regressed": 1, "unchanged_pass": 1, "unchanged_fail": 0})

    def test_all_non_intervention_version_changes_make_comparison_inconclusive(self):
        baseline = self.report()
        for field in ev.VERSION_KEYS - {"wiki", "skill", "dataset", "harness"}:
            with self.subTest(field=field):
                old = self.runs[0]["versions"][field]
                for run in self.runs:
                    run["versions"][field] = "changed"
                result = ev.compare_reports(baseline, self.report())
                self.assertEqual(result["status"], "INCONCLUSIVE")
                self.assertIn("confounded_pair_versions", result["reasons"])
                for run in self.runs:
                    run["versions"][field] = old

    def test_unknown_version_metadata_cannot_hide_a_confound(self):
        baseline = self.report()
        for run in self.runs:
            run["versions"]["new_retrieval_setting"] = "changed"
        self.assertEqual(ev.compare_reports(baseline, self.report())["status"], "INCONCLUSIVE")

    def test_missing_pair_stays_in_planned_denominator(self):
        baseline = self.report()
        self.runs.pop()
        self.reviews.pop()
        result = ev.compare_reports(baseline, self.report())
        self.assertEqual(result["status"], "INCONCLUSIVE")
        self.assertEqual(result["planned_pairs"], 3)
        self.assertEqual(result["comparable_pairs"], 2)

    def test_pending_review_is_not_a_compared_failure(self):
        baseline = self.report()
        self.reviews[0]["answer_verdict"] = "pending"
        result = ev.compare_reports(baseline, self.report())
        self.assertEqual(result["status"], "INCONCLUSIVE")
        self.assertEqual(result["counts"]["regressed"], 0)
        self.assertEqual(result["comparable_pairs"], 2)

    def test_changed_dataset_or_repetition_plan_is_not_matched(self):
        baseline = self.report()
        repeated = self.report(repeats=2)
        self.assertEqual(ev.compare_reports(baseline, repeated)["planned_pairs"], 6)
        self.assertIn("different_evaluation_plans", ev.compare_reports(baseline, repeated)["reasons"])
        self.cases[0]["question"] += " with a changed requirement"
        self.refresh_cases()
        result = ev.compare_reports(baseline, self.report())
        self.assertIn("different_datasets_or_rubrics", result["reasons"])
        self.assertEqual(result["status"], "INCONCLUSIVE")

    def test_reconstructed_report_cannot_drop_rows_or_review_provenance(self):
        baseline = self.report()
        for change in ("drop", "duplicate", "review", "split", "counts", "verdict", "versions"):
            with self.subTest(change=change):
                candidate = copy.deepcopy(baseline)
                if change == "drop":
                    candidate["rows"].pop()
                elif change == "duplicate":
                    candidate["rows"][1] = copy.deepcopy(candidate["rows"][0])
                elif change == "review":
                    candidate["rows"][0]["review"] = None
                elif change == "split":
                    candidate["rows"][0]["split"] = "dev"
                elif change == "counts":
                    candidate["overall_counts"]["reviewed_success"] = 999
                elif change == "verdict":
                    candidate["rows"][0]["answer"] = "fail"
                else:
                    del candidate["rows"][0]["versions"]["code"]
                with self.assertRaises(ev.InputError):
                    ev.compare_reports(baseline, candidate)

    def test_fabricated_pass_summary_is_rejected(self):
        self.reviews[0]["answer_verdict"] = "fail"
        baseline = self.report()
        tampered = copy.deepcopy(baseline)
        tampered["gates"]["C"]["gate"] = "PASS"
        with self.assertRaisesRegex(ev.InputError, "gates"):
            ev.compare_reports(baseline, tampered)

    def test_synthetic_comparison_is_not_real_quality_evidence(self):
        baseline = self.report()
        self.runs[0]["execution"] = "synthetic"
        result = ev.compare_reports(baseline, self.report())
        self.assertEqual(result["status"], "INCONCLUSIVE")
        self.assertEqual(result["comparable_pairs"], 2)


class InputTests(unittest.TestCase):
    def test_jsonl_and_json_roundtrip(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "records.jsonl"
            records = [{"한글": [True, None, 2]}, {"text": "second"}]
            ev.write_records(path, records)
            self.assertEqual(ev.read_records(path), records)
            path = Path(tmp) / "records.json"
            path.write_text(json.dumps(records), encoding="utf-8")
            self.assertEqual(ev.read_records(path), records)

    def test_nonfinite_and_duplicate_json_keys_rejected(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "records.json"
            for body in ('[{"x": NaN}]', '[{"x": Infinity}]', '[{"x": -Infinity}]',
                         '[{"x": 1e999}]', '[{"x": 1, "x": 2}]'):
                with self.subTest(body=body):
                    path.write_text(body, encoding="utf-8")
                    with self.assertRaises(ev.InputError):
                        ev.read_records(path)

    def test_direct_non_json_or_nonfinite_values_rejected(self):
        for value in (float("nan"), float("inf"), {1: "non-string-key"}, {"x": object()}):
            with self.subTest(value=repr(value)), self.assertRaises(ev.InputError):
                ev.digest(value)

    def test_malformed_input_types_raise_inputerror_not_typeerror(self):
        cases, runs, reviews = records()
        for field, value in (("case_id", []), ("run_id", {}), ("condition", []), ("repeat", True),
                             ("versions", []), ("input_tokens", True), ("elapsed_ms", -1)):
            with self.subTest(field=field):
                changed = copy.deepcopy(runs)
                changed[0][field] = value
                with self.assertRaises(ev.InputError):
                    ev.evaluate(cases, changed, reviews, ("C",))
        for value in ({}, "", 0, False):
            with self.subTest(reviews=value), self.assertRaises(ev.InputError):
                ev.evaluate(cases, runs, value, ("C",))
        with self.assertRaises(ev.InputError):
            ev.evaluate(cases, runs, reviews, (["C"],))

    def test_malformed_report_requires_all_status_fields(self):
        cases, runs, reviews = records()
        report = ev.evaluate(cases, runs, reviews, ("C",))
        for field in ("objective", "answer", "evidence", "missing", "review", "metrics"):
            with self.subTest(field=field):
                changed = copy.deepcopy(report)
                del changed["rows"][0][field]
                with self.assertRaises(ev.InputError):
                    ev.validate_report(changed)


if __name__ == "__main__":
    unittest.main()
