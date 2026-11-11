"""Trusted external-command runner. File snapshots are NOT an OS security sandbox."""
from __future__ import annotations

import hashlib
import json
import math
import os
from pathlib import Path, PurePosixPath
import signal
import subprocess
import time
from datetime import datetime, timezone

from .core import VERSION, digest, make_plan, validate_cases

RUNNER_SCHEMA = "allcll-command-runner-v1"
METADATA_KEYS = ("model", "model_config", "prompt", "code", "data", "tools", "runtime")
GROUPS = ("sources", "wiki", "skills")
BLOCKED_PARTS = {".git", ".aws", ".ssh", "private", "private_data", "private-data",
                 "student", "students", "student_data", "student-data", "student_records",
                 "student-records", "pii", "secrets", "credentials", "datasets"}
GOLD_KEYS = {"expected", "expected_answer", "expected_facts", "expected_action", "gold", "gold_answer",
             "ground_truth", "oracle", "oracle_reviewer", "review", "reviews", "review_status",
             "sources", "source_excerpt", "source_excerpts", "answer_key", "answer_keys"}
OUTPUT_CONTRACT = {
    "action": ["answer", "clarify", "escalate"],
    "facts": "JSON object of task facts; field names must be specified by the task prompt",
    "answer_text": "string: complete user-facing answer, including uncertainty",
    "citations": "array of strings identifying supporting context paths or source locations",
}


class RunnerError(ValueError):
    """Invalid configuration, changed snapshot, or attempted overwrite."""


def _require(condition, message):
    if not condition:
        raise RunnerError(message)


def _now():
    return datetime.now(timezone.utc).isoformat()


def _load(path):
    def pairs(items):
        result = {}
        for key, value in items:
            _require(key not in result, "Duplicate JSON key: " + key)
            result[key] = value
        return result
    def constant(value):
        raise RunnerError("Nonfinite JSON value: " + value)
    return json.loads(Path(path).read_text(encoding="utf-8"), object_pairs_hook=pairs, parse_constant=constant)


def _json(value):
    return json.dumps(value, ensure_ascii=False, indent=2, allow_nan=False) + "\n"


def _write_new(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("x", encoding="utf-8") as stream:
        stream.write(_json(value))


def _content_hash(content):
    return "sha256:" + hashlib.sha256(content).hexdigest()


def _relative(value):
    _require(isinstance(value, str) and value.strip() and "\\" not in value, "Expected explicit POSIX relative file path")
    path = PurePosixPath(value)
    _require(not path.is_absolute() and not any(p in ("", ".", "..") for p in value.split("/")), "Path must stay below its allowlisted root")
    _require(not any(c in value for c in "*?[]"), "Globs are not accepted; list each file explicitly")
    return path


def _safe_source(root, relative):
    parts = _relative(relative).parts
    candidate = root.joinpath(*parts)
    resolved = candidate.resolve(strict=True)
    _require(resolved.is_relative_to(root), "Source symlink escapes context_root: " + relative)
    for part in (*parts, *resolved.relative_to(root).parts):
        lower = part.lower()
        _require(lower not in BLOCKED_PARTS and not lower.startswith(".env"), "Sensitive/private source path rejected: " + relative)
    _require(resolved.is_file(), "Only explicit files are allowed: " + relative)
    return resolved


def _safe_inputs(value):
    if isinstance(value, dict):
        for key, child in value.items():
            _require(isinstance(key, str) and key.lower().replace("-", "_") not in GOLD_KEYS,
                     "Evaluation/oracle key is not allowed in task inputs: " + str(key))
            _safe_inputs(child)
    elif isinstance(value, list):
        for child in value:
            _safe_inputs(child)
    elif isinstance(value, float):
        _require(math.isfinite(value), "Nonfinite task input")
    else:
        _require(value is None or type(value) in (str, int, bool), "Task inputs must be JSON values")


def prepare(cases, config, outdir):
    """Freeze safe requests/context and an evaluation grid into a NEW output directory.

    `sources`, `wiki`, `skills` are explicit paths relative to `context_root`.
    Callers must review inputs and context files: key/path checks cannot detect
    secrets or gold answers hidden in otherwise innocuous text.
    """
    validate_cases(cases)
    _require(isinstance(config, dict), "config must be an object")
    for key in METADATA_KEYS:
        _require(isinstance(config.get(key), str) and config[key].strip(), "Required immutable metadata: " + key)
    instructions = config.get("instructions", "")
    _require(isinstance(instructions, str), "instructions must be a string")
    prompt_snapshot = {"declared": config["prompt"], "instructions": instructions, "output_contract": OUTPUT_CONTRACT}
    conditions, repeats = config.get("conditions", ["A", "B", "C"]), config.get("repeats", 1)
    evaluation_plan = make_plan(cases, conditions, repeats)
    execution = config.get("execution", "synthetic")
    _require(execution in ("real", "synthetic"), "execution must be real or synthetic")
    timeout = config.get("timeout", 60)
    _require(type(timeout) in (int, float) and math.isfinite(timeout) and timeout > 0, "timeout must be positive and finite")
    _require(isinstance(config.get("context_root"), str), "context_root is required")
    root = Path(config["context_root"]).expanduser().resolve(strict=True)
    _require(root.is_dir(), "context_root must be a directory")
    snapshots, manifests = {}, {}
    for group in GROUPS:
        paths = config.get(group, [])
        _require(isinstance(paths, list) and all(isinstance(p, str) for p in paths), group + " must be a file path list")
        _require(len(paths) == len(set(paths)), "Duplicate allowlisted paths in " + group)
        snapshots[group], manifests[group] = {}, []
        for relative in sorted(paths):
            content = _safe_source(root, relative).read_bytes()
            snapshots[group][relative] = content
            manifests[group].append({"path": relative, "sha256": _content_hash(content), "bytes": len(content)})
    _require(bool(manifests["sources"]), "At least one original source file is required")
    _require(not any(c in conditions for c in ("B", "C")) or bool(manifests["wiki"]), "B/C require an explicit WIKI snapshot")
    _require("C" not in conditions or bool(manifests["skills"]), "C requires an explicit Skill snapshot")
    jobs, requests = [], {}
    for index, case in enumerate(cases):
        inputs = case.get("inputs", {})
        _require(isinstance(inputs, dict), "Case inputs must be an object")
        _safe_inputs(inputs)
        for repeat in range(1, repeats + 1):
            for condition in conditions:
                included = ("sources",) + (("wiki",) if condition in ("B", "C") else ()) + (("skills",) if condition == "C" else ())
                job_id = f"{condition}-{index + 1:04d}-{repeat:03d}"
                context, files = {g: [] for g in GROUPS}, []
                for group in included:
                    for item in manifests[group]:
                        path = "context/" + group + "/" + item["path"]
                        context[group].append(path)
                        files.append({**item, "path": path})
                request = {"job_id": job_id, "case_id": case["id"], "condition": condition,
                           "question": case["question"], "inputs": inputs, "context": context,
                           "instructions": instructions, "output_contract": OUTPUT_CONTRACT}
                requests[job_id] = request
                jobs.append({"job_id": job_id, "case_id": case["id"], "condition": condition, "repeat": repeat,
                             "case_sha256": digest(case), "request_sha256": digest(request), "files": files})
    plan = {"schema": RUNNER_SCHEMA, "created_at": _now(), "execution": execution, "timeout": timeout,
            "metadata": {**{k: config[k] for k in METADATA_KEYS}, "prompt": digest(prompt_snapshot)},
            "prompt_snapshot": prompt_snapshot, "evaluation_plan": evaluation_plan,
            "context_manifest": manifests, "jobs": jobs,
            "warning": "Trusted adapter, inherited environment; NOT an OS sandbox or credential boundary."}
    plan["plan_sha256"] = digest(plan)
    destination = Path(outdir)
    _require(not destination.exists(), "Output directory already exists; prepare requires a fresh directory")
    destination.mkdir(parents=True, exist_ok=False)
    for job in jobs:
        directory = destination / "jobs" / job["job_id"]
        _write_new(directory / "request.json", requests[job["job_id"]])
        for item in job["files"]:
            _, group, relative = item["path"].split("/", 2)
            target = directory / item["path"]
            target.parent.mkdir(parents=True, exist_ok=True)
            with target.open("xb") as stream:
                stream.write(snapshots[group][relative])
    _write_new(destination / "plan.json", plan)
    return plan


def _local_file(root, relative):
    path = root.joinpath(*_relative(relative).parts)
    current = root
    for part in path.relative_to(root).parts:
        current = current / part
        _require(not current.is_symlink(), "Snapshot symlinks are not allowed: " + relative)
    _require(path.is_file() and path.resolve().is_relative_to(root), "Missing/escaped snapshot file: " + relative)
    return path


def _validate_job(job, root):
    jid = job["job_id"]
    directory = root / "jobs" / jid
    request_path = _local_file(root, "jobs/" + jid + "/request.json")
    request = _load(request_path)
    _require(digest(request) == job["request_sha256"], "Request snapshot changed: " + jid)
    allowed = {"request.json"}
    for item in job["files"]:
        file = _local_file(root, "jobs/" + jid + "/" + item["path"])
        content = file.read_bytes()
        _require(_content_hash(content) == item["sha256"] and len(content) == item["bytes"], "Context snapshot changed: " + str(file))
        allowed.add(item["path"])
    actual = {p.relative_to(directory).as_posix() for p in directory.rglob("*") if p.is_file() or p.is_symlink()}
    _require(actual == allowed, "Unexpected files in fresh job directory: " + jid)


def _validate_snapshot(plan, root):
    _require(isinstance(plan, dict) and plan.get("schema") == RUNNER_SCHEMA, "Unsupported runner plan")
    unsigned = {k: v for k, v in plan.items() if k != "plan_sha256"}
    _require(plan.get("plan_sha256") == digest(unsigned), "Runner plan checksum mismatch")
    ep = plan["evaluation_plan"]
    expected = {(c["case_id"], condition, repeat): c["case_sha256"] for c in ep["cases"]
                for condition in ep["conditions"] for repeat in range(1, ep["repeats"] + 1)}
    seen, job_ids = set(), set()
    for job in plan["jobs"]:
        key = (job["case_id"], job["condition"], job["repeat"])
        _require(key in expected and key not in seen and job["case_sha256"] == expected[key], "Job grid differs from frozen evaluation plan")
        seen.add(key)
        jid = job["job_id"]
        _require(isinstance(jid, str) and len(_relative(jid).parts) == 1 and jid not in job_ids, "Invalid/duplicate job id")
        job_ids.add(jid)
        _validate_job(job, root)
    _require(seen == set(expected), "Frozen plan is missing jobs")


def _text(value):
    return value.decode("utf-8", errors="replace") if isinstance(value, bytes) else value or ""


def _parse_output(stdout):
    # Use the same strict JSON parsing rules for the adapter's stdout.
    def pairs(items):
        result = {}
        for key, value in items:
            _require(key not in result, "Duplicate adapter output key")
            result[key] = value
        return result
    output = json.loads(stdout, object_pairs_hook=pairs, parse_constant=lambda x: (_ for _ in ()).throw(RunnerError("Nonfinite adapter output")))
    _require(isinstance(output, dict), "Adapter stdout must be one JSON object")
    _require(output.get("action") in ("answer", "clarify", "escalate"), "Adapter action invalid")
    _require(isinstance(output.get("facts"), dict), "Adapter facts must be an object")
    _require(isinstance(output.get("answer_text"), str) and bool(output["answer_text"].strip()), "Adapter answer_text must be a nonempty string")
    _require(isinstance(output.get("citations"), list) and all(isinstance(c, str) for c in output["citations"]), "Adapter citations must be a string array")
    return output


def _invoke(command, request, directory, timeout):
    """A POSIX process group allows timeout cleanup of ordinary CLI descendants."""
    with subprocess.Popen(list(command), stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                          text=True, encoding="utf-8", errors="replace", cwd=directory,
                          start_new_session=True, shell=False) as process:
        try:
            stdout, stderr = process.communicate(request, timeout=timeout)
        except subprocess.TimeoutExpired:
            try:
                os.killpg(process.pid, signal.SIGKILL)
            except ProcessLookupError:
                pass
            stdout, stderr = process.communicate()
            raise subprocess.TimeoutExpired(command, timeout, output=stdout, stderr=stderr)
        finally:
            # An ordinary background descendant must not outlive an adapter even
            # when the adapter exits successfully. Deliberately escaped sessions
            # need an operator-provided OS sandbox; this is not that boundary.
            try:
                os.killpg(process.pid, signal.SIGKILL)
            except ProcessLookupError:
                pass
        return subprocess.CompletedProcess(command, process.returncode, stdout, stderr)


def run_plan(plan_path, command):
    """Execute each job once with shell=False; command is trusted, not sandboxed.

    Requires POSIX (macOS/Linux) for process-group cleanup. The adapter inherits
    environment credentials. It can access sibling files and
    the network under the operator's OS permissions. Interrupted plans cannot be
    resumed; prepare a new directory for another attempt. No automatic retries.
    """
    _require(os.name == "posix", "Command execution currently requires POSIX process-group cleanup (macOS/Linux)")
    _require(isinstance(command, (list, tuple)) and command and all(isinstance(x, str) and x for x in command), "command must be a nonempty argv list")
    # The invoked model/budget flags are part of the experiment, not just the
    # operator's declared metadata. Hash explicit scripts without storing args.
    adapter = {"argv": list(command), "files": {}}
    for arg in command:
        file = Path(arg)
        if file.is_absolute() and file.is_file():
            adapter["files"][arg] = _content_hash(file.read_bytes())
    adapter_hash = digest(adapter)
    path = Path(plan_path).resolve(strict=True)
    root, plan = path.parent, _load(path)
    _require(not (root / "runs.jsonl").exists() and not (root / "started.json").exists(), "Plan already started; refusing overwrite or retry")
    _validate_snapshot(plan, root)
    _write_new(root / "started.json", {"started_at": _now(), "plan_sha256": plan["plan_sha256"]})
    records = []
    with (root / "runs.jsonl").open("x", encoding="utf-8") as stream:
        for job in plan["jobs"]:
            _validate_job(job, root)
            directory = root / "jobs" / job["job_id"]
            request = (directory / "request.json").read_text(encoding="utf-8")
            condition = job["condition"]
            manifest = plan["context_manifest"]
            versions = {**plan["metadata"], "adapter": adapter_hash, "harness": VERSION, "dataset": plan["evaluation_plan"]["dataset_sha256"],
                        "source": digest(manifest["sources"]), "wiki": digest(manifest["wiki"]) if condition in ("B", "C") else "none",
                        "skill": digest(manifest["skills"]) if condition == "C" else "none"}
            record = {"run_id": job["job_id"], "case_id": job["case_id"], "condition": condition, "repeat": job["repeat"],
                      "case_sha256": job["case_sha256"], "versions": versions, "execution": plan["execution"],
                      "started_at": _now(), "input_tokens": None, "output_tokens": None, "plan_sha256": plan["plan_sha256"]}
            start, stdout, stderr = time.monotonic(), "", ""
            try:
                completed = _invoke(command, request, directory, plan["timeout"])
                stdout, stderr = completed.stdout, completed.stderr
                _require(completed.returncode == 0, "adapter_exit_" + str(completed.returncode))
                output = _parse_output(stdout)
                record.update(status="ok", output=output, output_sha256=digest(output))
            except subprocess.TimeoutExpired as exc:
                stdout, stderr = _text(exc.stdout), _text(exc.stderr)
                record.update(status="error", error="adapter_timeout")
            except (OSError, ValueError, RunnerError) as exc:
                record.update(status="error", error=str(exc))
            record["elapsed_ms"] = round((time.monotonic() - start) * 1000, 3)
            (directory / "stdout.txt").write_text(stdout, encoding="utf-8")
            (directory / "stderr.txt").write_text(stderr, encoding="utf-8")
            _write_new(directory / "result.json", record)
            stream.write(json.dumps(record, ensure_ascii=False, allow_nan=False) + "\n")
            stream.flush()
            os.fsync(stream.fileno())
            records.append(record)
    return records
