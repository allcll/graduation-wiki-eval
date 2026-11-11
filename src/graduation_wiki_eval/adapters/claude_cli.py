"""Read-only Claude Code adapter using explicitly supplied context documents."""
from __future__ import annotations

import argparse
import json
import math
import os
from pathlib import Path, PurePosixPath
import re
import subprocess
import sys
import tempfile

MINIMUM_CLI_VERSION = (2, 1, 322)
GROUPS = ("sources", "wiki", "skills")
OUTPUT_SCHEMA = {
    "type": "object",
    "properties": {
        "action": {"type": "string", "enum": ["answer", "clarify", "escalate"]},
        "facts": {"type": "object"},
        "answer_text": {"type": "string", "minLength": 1},
        "citations": {"type": "array", "items": {"type": "string"}},
    },
    "required": ["action", "facts", "answer_text", "citations"],
    "additionalProperties": False,
}
INSTRUCTIONS = """Answer the task using only the supplied input and listed context files.
Read the relevant original sources and check the policy's target and exceptions.
If procedural documents are listed under skills, choose which are relevant and read
them as documents. Native Claude Code skills are disabled in this evaluation.
Do not read unlisted files, run commands, modify files, or contact external tools.
If required information is missing, ask for it; if authoritative sources conflict
without a resolution, explain the conflict and request human confirmation.
Return the complete user-facing answer in answer_text and source locations in
citations. Use the facts field names specified by the task; do not invent a
confidence score or a self-grading verdict. Return the required structured output.
"""


class AdapterError(ValueError):
    """A request or subprocess result cannot be used as an evaluation response."""


def _require(ok, message):
    if not ok:
        raise AdapterError(message)


def _json(text):
    def pairs(items):
        result = {}
        for key, value in items:
            _require(key not in result, "Duplicate JSON key")
            result[key] = value
        return result

    def constant(_value):
        raise AdapterError("Nonfinite JSON value")

    return json.loads(text, object_pairs_hook=pairs, parse_constant=constant)


def validate_request(request, cwd):
    _require(isinstance(request, dict), "Request must be a JSON object")
    required = {"job_id", "case_id", "condition", "question", "inputs", "context", "instructions", "output_contract"}
    _require(set(request) == required, "Request must contain only the runner request fields")
    _require(request["condition"] in ("A", "B", "C"), "Invalid evaluation condition")
    _require(isinstance(request["question"], str) and request["question"].strip(), "Question is required")
    _require(isinstance(request["inputs"], dict), "Task inputs must be an object")
    _require(isinstance(request["instructions"], str), "Common instructions must be a string")
    _require(isinstance(request["output_contract"], dict), "Output contract must be an object")
    context = request["context"]
    _require(isinstance(context, dict) and set(context) == set(GROUPS), "Invalid context groups")
    if request["condition"] == "A":
        _require(not context["wiki"] and not context["skills"], "A cannot include WIKI or Skill files")
    if request["condition"] == "B":
        _require(not context["skills"], "B cannot include Skill files")
    root = Path(cwd).resolve()
    for group in GROUPS:
        paths = context[group]
        _require(isinstance(paths, list), "Context paths must be a list")
        _require(all(isinstance(p, str) for p in paths), "Context paths must be strings")
        _require(len(paths) == len(set(paths)), "Duplicate context paths")
        for value in paths:
            path = PurePosixPath(value)
            _require(not path.is_absolute() and "\\" not in value and
                     all(p not in ("", ".", "..") for p in value.split("/")), "Invalid context path")
            _require(path.parts[:2] == ("context", group), "Context file is in the wrong group")
            resolved = (root / value).resolve(strict=True)
            _require(resolved.is_relative_to(root) and resolved.is_file(), "Context file escapes the job directory")


def build_command(model, budget, max_turns=12, effort="medium", executable="claude"):
    _require(isinstance(model, str) and model.strip() and not model.startswith("-"), "Explicit model ID is required")
    _require(model not in {"sonnet", "opus", "haiku", "fable", "default"}, "Use a pinned model ID, not a moving alias")
    _require(type(budget) in (int, float) and math.isfinite(budget) and budget > 0, "Budget must be finite and positive")
    _require(type(max_turns) is int and max_turns > 0, "max-turns must be positive")
    _require(effort in ("low", "medium", "high", "xhigh", "max"), "Invalid effort level")
    return [executable, "--bare", "--restricted", "-p", "--disable-slash-commands",
            "--tools", "Read,Grep,Glob", "--allowedTools", "Read,Grep,Glob",
            "--disallowedTools", "mcp__*", "--permission-mode", "dontAsk",
            "--permission-prompts", "none", "--no-chrome", "--setting-sources", "",
            "--strict-mcp-config", "--mcp-config", '{"mcpServers":{}}',
            "--no-session-persistence", "--output-format", "json",
            "--json-schema", json.dumps(OUTPUT_SCHEMA, separators=(",", ":")),
            "--model", model, "--effort", effort, "--max-budget-usd", str(budget),
            "--max-turns", str(max_turns), "--append-system-prompt", INSTRUCTIONS]


def parse_response(stdout):
    response = _json(stdout)
    _require(isinstance(response, dict), "Claude result must be one JSON object")
    _require(response.get("type") == "result" and response.get("subtype") == "success" and
             response.get("is_error") is False, "Claude did not return a successful result")
    output = response.get("structured_output")
    _require(isinstance(output, dict) and set(output) == set(OUTPUT_SCHEMA["required"]), "Missing or invalid structured output")
    _require(output["action"] in ("answer", "clarify", "escalate"), "Invalid action")
    _require(isinstance(output["facts"], dict), "Facts must be an object")
    _require(isinstance(output["answer_text"], str) and bool(output["answer_text"].strip()), "Full answer_text is required")
    _require(isinstance(output["citations"], list) and all(isinstance(c, str) for c in output["citations"]), "Citations must be strings")
    return output


def invoke(request, model, budget, max_turns=12, effort="medium", timeout=120, executable="claude"):
    validate_request(request, Path.cwd())
    command = build_command(model, budget, max_turns, effort, executable)
    _require(type(timeout) in (int, float) and math.isfinite(timeout) and timeout > 0, "Timeout must be finite and positive")
    _require(bool(os.environ.get("ANTHROPIC_API_KEY")), "ANTHROPIC_API_KEY is required; bare mode does not use subscription login")
    version = subprocess.run([executable, "--version"], capture_output=True, text=True,
                             encoding="utf-8", timeout=10, check=False)
    match = re.match(r"(\d+)\.(\d+)\.(\d+)\b", version.stdout.strip())
    _require(version.returncode == 0 and match is not None, "Could not determine Claude Code version")
    _require(tuple(int(v) for v in match.groups()) >= MINIMUM_CLI_VERSION, "Claude Code 2.1.322 or newer is required")
    prompt = json.dumps({k: request[k] for k in ("question", "inputs", "context", "instructions", "output_contract")}, ensure_ascii=False, allow_nan=False)
    # A fresh config directory and fixed flags reduce accidental user customization.
    # These controls are application settings, not an OS process sandbox.
    with tempfile.TemporaryDirectory(prefix="gradwiki-claude-") as config_dir:
        env = dict(os.environ)
        env.update({"CLAUDE_CONFIG_DIR": config_dir,
                    "CLAUDE_CODE_EFFORT_LEVEL": effort,
                    "CLAUDE_CODE_DISABLE_AUTO_MEMORY": "1",
                    "CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC": "1",
                    "CLAUDE_CODE_DISABLE_BACKGROUND_TASKS": "1",
                    "CLAUDE_CODE_DISABLE_TERMINAL_TITLE": "1",
                    "MAX_STRUCTURED_OUTPUT_RETRIES": "1"})
        result = subprocess.run(command, input=prompt, capture_output=True, text=True,
                                encoding="utf-8", timeout=timeout, check=False, env=env)
    _require(result.returncode == 0, f"Claude Code exited with status {result.returncode}; response rejected")
    return parse_response(result.stdout)


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--model", required=True, help="Pinned Anthropic model ID")
    parser.add_argument("--max-budget-usd", type=float, required=True, help="Per-job estimated API spend cap")
    parser.add_argument("--max-turns", type=int, default=12)
    parser.add_argument("--effort", choices=("low", "medium", "high", "xhigh", "max"), default="medium")
    parser.add_argument("--timeout", type=float, default=120)
    args = parser.parse_args(argv)
    try:
        request = _json(sys.stdin.read())
        output = invoke(request, args.model, args.max_budget_usd, args.max_turns, args.effort, args.timeout)
        print(json.dumps(output, ensure_ascii=False, allow_nan=False))
        return 0
    except (ValueError, OSError, TypeError, subprocess.TimeoutExpired) as exc:
        # Do not relay upstream stderr: it can contain prompts or credential details.
        detail = str(exc) if isinstance(exc, AdapterError) else type(exc).__name__
        print("Claude adapter failed: " + detail, file=sys.stderr)
        return 2


if __name__ == "__main__":
    sys.exit(main())
