"""Offline subprocess tests. No network, model, credentials, or real student data."""
import json
from pathlib import Path
import sys
import tempfile
import time
import unittest

from graduation_wiki_eval import core
from graduation_wiki_eval.runner import RunnerError, prepare, run_plan


ADAPTER = """import json, pathlib, sys
request = json.load(sys.stdin)
assert 'expected' not in request and 'sources' not in request
for paths in request['context'].values():
    for path in paths:
        assert pathlib.Path(path).is_file()
print(json.dumps({'action': 'answer', 'facts': {'toy_result': 7},
                  'answer_text': 'Synthetic adapter output, not model performance.',
                  'citations': request['context']['sources']}))
"""


class RunnerTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.context = self.root / "public-context"
        self.context.mkdir()
        for name in ("source.md", "wiki.md", "skill.md"):
            (self.context / name).write_text("INVENTED TOY CONTENT ONLY: " + name, encoding="utf-8")
        self.adapter = self.root / "adapter.py"
        self.adapter.write_text(ADAPTER, encoding="utf-8")
        self.out = self.root / "prepared"
        self.config = {"context_root": str(self.context), "sources": ["source.md"],
                       "wiki": ["wiki.md"], "skills": ["skill.md"], "conditions": ["A", "B", "C"],
                       "model": "synthetic-adapter", "model_config": "fixture-v1", "prompt": "p1", "code": "none",
                       "data": "none", "tools": "none", "runtime": "stdlib-test", "timeout": 5}
        self.cases = [{"id": "toy", "family": "toy-rule", "split": "dev", "origin": "synthetic",
                       "review_status": "draft", "oracle_reviewer": None, "independent_reference": False,
                       "question": "INVENTED task: return toy_result as a number.", "inputs": {"toy_given": 7},
                       "expected": {"action": "answer", "facts": {"toy_result": 7}},
                       "sources": [{"id": "toy-source", "version": "invented", "locator": "GOLD-LOCATION-SECRET",
                                    "excerpt": "GOLD-EXCERPT-SECRET", "authoritative": False}]}]

    def prepare(self):
        return prepare(self.cases, self.config, self.out)

    def run_plan(self, code=None):
        argv = [sys.executable, str(self.adapter)] if code is None else [sys.executable, "-c", code]
        return run_plan(self.out / "plan.json", argv)

    def test_prepare_filters_gold_and_materializes_condition_context(self):
        plan = self.prepare()
        self.assertEqual(plan["execution"], "synthetic")
        self.assertEqual(len(plan["jobs"]), 3)
        self.assertEqual(plan["evaluation_plan"]["dataset_sha256"], core.dataset_hash(self.cases))
        for job in plan["jobs"]:
            path = self.out / "jobs" / job["job_id"] / "request.json"
            request = json.loads(path.read_text())
            self.assertNotIn("expected", request)
            self.assertNotIn("review_status", request)
            self.assertNotIn("sources", request)
            self.assertNotIn("GOLD-", path.read_text())
            self.assertEqual(bool(request["context"]["wiki"]), job["condition"] in ("B", "C"))
            self.assertEqual(bool(request["context"]["skills"]), job["condition"] == "C")
            self.assertEqual(request["inputs"], {"toy_given": 7})

    def test_explicit_safe_input_keys_are_checked_recursively(self):
        self.cases[0]["inputs"] = {"payload": [{"oracle": "secret"}]}
        with self.assertRaisesRegex(RunnerError, "oracle key"):
            self.prepare()
        self.assertFalse(self.out.exists())

    def test_source_path_allowlist_rejects_sensitive_glob_directory_and_escape(self):
        (self.context / ".env").write_text("dummy placeholder")
        (self.context / "students").mkdir()
        (self.context / "students" / "toy.json").write_text("{}")
        (self.root / "outside.md").write_text("outside")
        (self.context / "escape.md").symlink_to(self.root / "outside.md")
        for relative in (".env", "students/toy.json", "students", "*.md", "../outside.md", "escape.md"):
            with self.subTest(path=relative):
                self.config["sources"] = [relative]
                with self.assertRaises((RunnerError, FileNotFoundError)):
                    self.prepare()
                self.assertFalse(self.out.exists())

    def test_existing_directory_and_missing_required_context_are_rejected(self):
        self.config["wiki"] = []
        with self.assertRaisesRegex(RunnerError, "WIKI"):
            self.prepare()
        self.config["wiki"] = ["wiki.md"]
        self.out.mkdir()
        with self.assertRaisesRegex(RunnerError, "already exists"):
            self.prepare()

    def test_run_records_have_actual_elapsed_unknown_tokens_and_synthetic_label(self):
        plan = self.prepare()
        records = self.run_plan()
        self.assertEqual(len(records), 3)
        for record in records:
            self.assertEqual(record["status"], "ok")
            self.assertEqual(record["execution"], "synthetic")
            self.assertGreater(record["elapsed_ms"], 0)
            self.assertIsNone(record["input_tokens"])
            self.assertIsNone(record["output_tokens"])
            self.assertEqual(record["output_sha256"], core.digest(record["output"]))
            self.assertEqual(record["plan_sha256"], plan["plan_sha256"])
            self.assertTrue((self.out / "jobs" / record["run_id"] / "result.json").is_file())
        report = core.evaluate(self.cases, records, plan=plan["evaluation_plan"])
        self.assertEqual({g["gate"] for g in report["gates"].values()}, {"INCONCLUSIVE"})

    def test_common_instructions_and_prompt_hash_are_frozen(self):
        self.config.update(instructions="Facts must use toy_result only.", repeats=2)
        plan = self.prepare()
        self.assertEqual([j["condition"] for j in plan["jobs"]], ["A", "B", "C", "A", "B", "C"])
        for job in plan["jobs"]:
            request = json.loads((self.out / "jobs" / job["job_id"] / "request.json").read_text())
            self.assertEqual(request["instructions"], self.config["instructions"])
        first_hash = plan["metadata"]["prompt"]
        self.config["instructions"] = "Changed public output format."
        self.out = self.root / "other-plan"
        self.assertNotEqual(self.prepare()["metadata"]["prompt"], first_hash)

    def test_source_changes_after_prepare_do_not_change_frozen_copy(self):
        self.prepare()
        (self.context / "source.md").write_text("changed original")
        records = self.run_plan()
        self.assertEqual(records[0]["status"], "ok")
        frozen = self.out / "jobs" / "A-0001-001" / "context" / "sources" / "source.md"
        self.assertIn("INVENTED", frozen.read_text())

    def test_plan_request_context_and_extra_file_changes_fail_before_start(self):
        for changed in ("plan", "request", "context", "extra"):
            with self.subTest(changed=changed):
                self.out = self.root / ("prepared-" + changed)
                self.prepare()
                job = self.out / "jobs" / "A-0001-001"
                if changed == "plan":
                    target = self.out / "plan.json"
                    plan = json.loads(target.read_text())
                    plan["execution"] = "real"
                    target.write_text(json.dumps(plan))
                elif changed == "request":
                    (job / "request.json").write_text("{}")
                elif changed == "context":
                    (job / "context" / "sources" / "source.md").write_text("different")
                else:
                    (job / "gold.txt").write_text("unexpected")
                with self.assertRaises(RunnerError):
                    self.run_plan()
                self.assertFalse((self.out / "started.json").exists())

    def test_grid_cannot_silently_drop_planned_jobs(self):
        plan = self.prepare()
        plan["jobs"].pop()
        del plan["plan_sha256"]
        plan["plan_sha256"] = core.digest(plan)
        (self.out / "plan.json").write_text(json.dumps(plan))
        with self.assertRaisesRegex(RunnerError, "missing jobs"):
            self.run_plan()

    def test_reexecution_is_blocked_and_prior_results_preserved(self):
        self.prepare()
        self.run_plan()
        original = (self.out / "runs.jsonl").read_bytes()
        with self.assertRaisesRegex(RunnerError, "already started"):
            self.run_plan()
        self.assertEqual((self.out / "runs.jsonl").read_bytes(), original)

    def test_timeout_is_recorded_without_retry(self):
        self.config.update(conditions=["A"], timeout=0.03)
        self.prepare()
        records = self.run_plan("import time; time.sleep(1)")
        self.assertEqual(len(records), 1)
        self.assertEqual(records[0]["status"], "error")
        self.assertEqual(records[0]["error"], "adapter_timeout")
        self.assertGreater(records[0]["elapsed_ms"], 0)

    def test_timeout_cleans_up_ordinary_adapter_grandchild(self):
        self.config.update(conditions=["A"], timeout=0.1)
        self.prepare()
        marker = self.root / "grandchild-survived"
        child = "import time; from pathlib import Path; time.sleep(0.4); Path(" + repr(str(marker)) + ").write_text('alive')"
        code = "import subprocess,sys,time; subprocess.Popen([sys.executable,'-c'," + repr(child) + "]); time.sleep(3)"
        record = self.run_plan(code)[0]
        self.assertEqual(record["error"], "adapter_timeout")
        time.sleep(0.5)
        self.assertFalse(marker.exists(), "Timeout must terminate an ordinary adapter subprocess tree")

    def test_nonzero_invalid_and_duplicate_json_outputs_record_errors(self):
        programs = ["import sys; sys.exit(3)", "print('not json')", "print('{}')",
                    "print('{\"action\":\"answer\",\"action\":\"clarify\"}')"]
        for index, code in enumerate(programs):
            with self.subTest(code=code):
                self.out = self.root / ("invalid-" + str(index))
                self.config["conditions"] = ["A"]
                self.prepare()
                record = self.run_plan(code)[0]
                self.assertEqual(record["status"], "error")
                self.assertNotIn("output_sha256", record)

    def test_argv_is_not_a_shell_command(self):
        self.config["conditions"] = ["A"]
        self.prepare()
        argument = "; touch SHOULD_NOT_EXIST"
        code = "import sys; assert sys.argv[1] == '; touch SHOULD_NOT_EXIST'; exec(" + repr(ADAPTER) + ")"
        records = run_plan(self.out / "plan.json", [sys.executable, "-c", code, argument])
        self.assertEqual(records[0]["status"], "ok")
        self.assertFalse((self.out / "jobs" / "A-0001-001" / "SHOULD_NOT_EXIST").exists())

    def test_cross_job_mutation_is_detected_before_next_execution(self):
        self.prepare()
        code = "from pathlib import Path\nPath('../B-0001-001/request.json').write_text('{}')\n" + ADAPTER
        with self.assertRaisesRegex(RunnerError, "Request snapshot changed"):
            self.run_plan(code)
        records = (self.out / "runs.jsonl").read_text().splitlines()
        self.assertEqual(len(records), 1)
        self.assertFalse((self.out / "jobs" / "B-0001-001" / "result.json").exists())


if __name__ == "__main__":
    unittest.main()
