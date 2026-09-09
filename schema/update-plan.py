#!/usr/bin/env python3
"""Atomically mark one Ralph Story complete after engine-owned verification."""

from __future__ import annotations

import argparse
import hashlib
import importlib.util
import json
import os
import sys
from pathlib import Path

VALIDATE_PATH = Path(__file__).with_name("validate-plan.py")


def load_validate():
    spec = importlib.util.spec_from_file_location("ralph_validate_plan", VALIDATE_PATH)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module


def sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(description="Atomically mark a Ralph Story complete")
    parser.add_argument("--plan", required=True)
    parser.add_argument("--story", required=True)
    parser.add_argument("--notes", required=True)
    parser.add_argument("--expected-sha256", required=True)
    args = parser.parse_args(argv)

    supplied_plan = Path(args.plan)
    if supplied_plan.is_symlink():
        print(f"{supplied_plan}: symlinked Plan is not allowed", file=sys.stderr)
        return 1
    plan_path = supplied_plan.resolve()

    try:
        original = plan_path.read_bytes()
    except FileNotFoundError:
        print(f"{plan_path}: file not found", file=sys.stderr)
        return 1
    if sha256(original) != args.expected_sha256:
        print(f"{plan_path}: Plan changed before engine update", file=sys.stderr)
        return 1

    validate = load_validate()
    problems = validate.validate(plan_path, "runtime")
    if problems:
        print("invalid Ralph Plan:", file=sys.stderr)
        for item in problems:
            print(item, file=sys.stderr)
        return 1

    plan = json.loads(original)
    stories = plan["userStories"]
    matches = [story for story in stories if story["id"] == args.story]
    if len(matches) != 1:
        print(f"{args.story}: Story not found", file=sys.stderr)
        return 1
    story = matches[0]
    if story["passes"]:
        print(f"{args.story}: Story already passed", file=sys.stderr)
        return 1
    by_id = {item["id"]: item for item in stories}
    incomplete = [dep for dep in story["dependencies"] if not by_id[dep]["passes"]]
    if incomplete:
        print(f"{args.story}: incomplete dependencies: {', '.join(incomplete)}", file=sys.stderr)
        return 1

    story["passes"] = True
    story["notes"] = args.notes
    candidate = json.dumps(plan, indent=2, ensure_ascii=False).encode() + b"\n"
    tmp = plan_path.with_name(f".{plan_path.name}.{os.getpid()}.tmp")
    try:
        tmp.write_bytes(candidate)
        problems = validate.validate(tmp, "runtime")
        if problems:
            print("invalid updated Ralph Plan:", file=sys.stderr)
            for item in problems:
                print(item, file=sys.stderr)
            return 1
        if sha256(plan_path.read_bytes()) != args.expected_sha256:
            print(f"{plan_path}: Plan changed during engine update", file=sys.stderr)
            return 1
        os.replace(tmp, plan_path)
    finally:
        if tmp.exists():
            tmp.unlink()
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
