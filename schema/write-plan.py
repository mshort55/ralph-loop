#!/usr/bin/env python3
"""Validate a candidate Ralph Plan and atomically install it at <repo>/.ralph/prd.json."""

from __future__ import annotations

import argparse
import importlib.util
import os
import subprocess
import sys
from pathlib import Path

VALIDATE_PATH = Path(__file__).with_name("validate-plan.py")


def load_validate():
    spec = importlib.util.spec_from_file_location("ralph_validate_plan", VALIDATE_PATH)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module


def git_ignored(repo: Path, relpath: str) -> bool:
    result = subprocess.run(
        ["git", "-C", str(repo), "check-ignore", "-q", "--", relpath],
        check=False,
    )
    return result.returncode == 0


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(description="Atomically write a validated Ralph Plan")
    parser.add_argument("--repo", required=True, help="Target Repository path")
    parser.add_argument("--from", dest="source", required=True, help="candidate JSON path")
    args = parser.parse_args(argv)

    repo = Path(args.repo).resolve()
    source = Path(args.source).resolve()
    ralph_dir = repo / ".ralph"
    dest = ralph_dir / "prd.json"

    if not (repo / ".git").exists() and not (repo / ".git").is_file():
        print(f"{repo}: not a Git repository", file=sys.stderr)
        return 1

    if ralph_dir.is_symlink():
        print(f"{ralph_dir}: symlinked .ralph directory is not allowed", file=sys.stderr)
        return 1
    try:
        ralph_dir.resolve(strict=False).relative_to(repo)
    except ValueError:
        print(f"{ralph_dir}: destination escapes Target Repository", file=sys.stderr)
        return 1
    if dest.exists() or dest.is_symlink():
        print(f"{dest}: Plan already exists; refuse to replace execution state", file=sys.stderr)
        return 1

    validate = load_validate()
    problems = validate.validate(source, "conversion")
    if problems:
        print("invalid Ralph Plan:", file=sys.stderr)
        for item in problems:
            print(item, file=sys.stderr)
        return 1

    if not git_ignored(repo, ".ralph/prd.json"):
        print(
            f"{repo}: .ralph/prd.json is not ignored; configure Ralph runtime-state ignores before conversion",
            file=sys.stderr,
        )
        return 1

    ralph_dir.mkdir(parents=True, exist_ok=True)
    tmp_name = dest.with_name(f".prd.json.{os.getpid()}.tmp")
    try:
        tmp_name.write_bytes(source.read_bytes())
        os.replace(tmp_name, dest)
    except Exception:
        if tmp_name.exists():
            tmp_name.unlink()
        raise
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
