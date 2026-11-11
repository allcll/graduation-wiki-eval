import json
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch

from graduation_wiki_eval.adapters import claude_cli as adapter


def request():
    return {"job_id": "A-1", "case_id": "sample", "condition": "A", "question": "Example",
            "inputs": {}, "context": {"sources": ["context/sources/original.md"], "wiki": [], "skills": []},
            "instructions": "Use the common facts schema", "output_contract": {}}


class ClaudeAdapterTests(unittest.TestCase):
    def test_command_has_fixed_read_only_session_and_budget(self):
        cmd = adapter.build_command("test-pinned-model", 0.1)
        for flag in ("--bare", "--restricted", "--disable-slash-commands", "--strict-mcp-config", "--no-session-persistence"):
            self.assertIn(flag, cmd)
        self.assertEqual(cmd[cmd.index("--tools") + 1], "Read,Grep,Glob")
        self.assertNotIn("--dangerously-skip-permissions", cmd)
        for budget in (0, -1, float("nan"), float("inf")):
            with self.assertRaises(adapter.AdapterError):
                adapter.build_command("test-pinned-model", budget)
        with self.assertRaises(adapter.AdapterError):
            adapter.build_command("sonnet", 1)

    def test_rejects_error_or_unstructured_responses(self):
        for result in ({"type": "result", "subtype": "error", "is_error": True},
                       {"type": "result", "subtype": "success", "is_error": False, "result": "```json {} ```"}):
            with self.assertRaises(adapter.AdapterError):
                adapter.parse_response(json.dumps(result))
        with self.assertRaises(adapter.AdapterError):
            adapter.parse_response('{"type":"result","type":"other"}')

    def test_rejects_cross_condition_or_escaping_context(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            file = root / "context/sources/original.md"
            file.parent.mkdir(parents=True)
            file.write_text("Fictional source")
            value = request()
            adapter.validate_request(value, root)
            value["context"]["wiki"] = ["context/wiki/a.md"]
            with self.assertRaises(adapter.AdapterError):
                adapter.validate_request(value, root)
            value["context"]["wiki"] = []
            value["context"]["sources"] = ["../answer-key.json"]
            with self.assertRaises(adapter.AdapterError):
                adapter.validate_request(value, root)

    def test_invoke_forwards_common_instructions_and_returns_only_answer(self):
        answer = {"action": "clarify", "facts": {"required_fields": ["admission_year"]},
                  "answer_text": "Which admission year?", "citations": []}
        result = {"type": "result", "subtype": "success", "is_error": False, "structured_output": answer}
        fake = [subprocess.CompletedProcess([], 0, "2.1.322 (Claude Code)", ""),
                subprocess.CompletedProcess([], 0, json.dumps(result), "")]
        with patch.object(adapter, "validate_request"), patch.dict(adapter.os.environ, {"ANTHROPIC_API_KEY": "unit-test-only"}), \
                patch.object(adapter.subprocess, "run", side_effect=fake) as run:
            self.assertEqual(adapter.invoke(request(), "test-pinned-model", 0.1), answer)
            sent = json.loads(run.call_args.kwargs["input"])
            self.assertEqual(sent["instructions"], request()["instructions"])
            self.assertNotIn("ANTHROPIC_API_KEY", sent)

    def test_no_credentials_prevents_subprocess_calls(self):
        with patch.object(adapter, "validate_request"), patch.dict(adapter.os.environ, {}, clear=True), \
                patch.object(adapter.subprocess, "run") as run:
            with self.assertRaises(adapter.AdapterError):
                adapter.invoke(request(), "test-pinned-model", 1)
            run.assert_not_called()


if __name__ == "__main__":
    unittest.main()
