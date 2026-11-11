import contextlib
import io
import json
from pathlib import Path
import tempfile
import unittest

from graduation_wiki_eval import cli, core


class CliTests(unittest.TestCase):
    def invoke(self, *args):
        stdout, stderr = io.StringIO(), io.StringIO()
        with contextlib.redirect_stdout(stdout), contextlib.redirect_stderr(stderr):
            code = cli.main(list(map(str, args)))
        return code, stdout.getvalue(), stderr.getvalue()

    def test_demo_report_review_and_compare_without_model(self):
        with tempfile.TemporaryDirectory() as tmp:
            out = Path(tmp) / "demo"
            code, stdout, _ = self.invoke("demo", "--out", out)
            self.assertEqual(code, 0)
            summary = json.loads(stdout)
            self.assertEqual(summary["counts"]["expected"], 9)
            self.assertEqual(set(summary["gates"].values()), {"INCONCLUSIVE"})
            args = ["report", "--cases", out / "cases.jsonl", "--runs", out / "experiment/runs.jsonl",
                    "--plan", out / "experiment/plan.json", "--out", out / "rechecked.json"]
            self.assertEqual(self.invoke(*args)[0], 0)
            self.assertEqual(self.invoke(*args, "--check")[0], 1)
            self.assertTrue((out / "rechecked.md").is_file())
            self.assertEqual(self.invoke("review-template", "--runs", out / "experiment/runs.jsonl",
                                         "--out", out / "reviews.jsonl")[0], 0)
            reviews = core.read_records(out / "reviews.jsonl")
            self.assertEqual(len(reviews), 9)
            self.assertTrue(all(r["answer_verdict"] == "pending" and not r["reviewer_id"] for r in reviews))
            self.assertEqual(self.invoke("compare", "--baseline", out / "report.json", "--candidate", out / "rechecked.json",
                                         "--split", "dev", "--out", out / "comparison.json")[0], 0)
            self.assertEqual(core.read_json(out / "comparison.json")["status"], "INCONCLUSIVE")
            self.assertEqual(self.invoke("demo", "--out", out)[0], 2)
            self.assertEqual(self.invoke("review-template", "--runs", out / "experiment/runs.jsonl",
                                         "--out", out / "reviews.jsonl")[0], 2)

    def test_invalid_input_replaces_stale_success_report(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "report.json"
            path.write_text('{"gate":"PASS"}')
            code, _, _ = self.invoke("report", "--cases", "missing.jsonl", "--runs", "missing.jsonl",
                                     "--plan", "missing.json", "--out", path)
            self.assertEqual(code, 2)
            self.assertEqual(core.read_json(path)["gate"], "INCONCLUSIVE")
            self.assertIn("INCONCLUSIVE", path.with_suffix(".md").read_text())

    def test_plan_does_not_overwrite_and_requires_json_records(self):
        with tempfile.TemporaryDirectory() as tmp:
            cases = Path(cli.__file__).parent / "sample/cases.jsonl"
            plan = Path(tmp) / "plan.json"
            args = ("plan", "--cases", cases, "--repeats", "3", "--out", plan)
            self.assertEqual(self.invoke(*args)[0], 0)
            self.assertEqual(self.invoke(*args)[0], 2)
            self.assertEqual(core.read_json(plan)["repeats"], 3)

    def test_report_cannot_overwrite_an_input_even_on_failure(self):
        with tempfile.TemporaryDirectory() as tmp:
            plan = Path(tmp) / "plan.json"
            original = '{"keep": "original plan"}'
            plan.write_text(original)
            self.assertEqual(self.invoke("report", "--cases", "missing.jsonl", "--runs", "missing.jsonl",
                                         "--plan", plan, "--out", plan)[0], 2)
            self.assertEqual(plan.read_text(), original)

    def test_config_and_plan_must_be_objects(self):
        with tempfile.TemporaryDirectory() as tmp:
            invalid = Path(tmp) / "invalid.json"
            invalid.write_text('[]')
            cases = Path(cli.__file__).parent / "sample/cases.jsonl"
            self.assertEqual(self.invoke("prepare", "--cases", cases, "--config", invalid,
                                         "--out", Path(tmp) / "experiment")[0], 2)
            with self.assertRaises(ValueError):
                cli._plan(invalid)


if __name__ == "__main__":
    unittest.main()
