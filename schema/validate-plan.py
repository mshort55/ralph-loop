#!/usr/bin/env python3
"""Validate a Ralph Plan against schemaVersion 1 and cross-Story invariants."""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any

SCHEMA_PATH = Path(__file__).with_name("ralph-plan.schema.json")


class Errors:
    def __init__(self) -> None:
        self.items: list[str] = []

    def add(self, path: str, message: str) -> None:
        self.items.append(f"{path}: {message}")


def dump(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False)


def resolve_ref(schema: dict[str, Any], node: dict[str, Any]) -> dict[str, Any]:
    ref = node.get("$ref")
    if not ref:
        return node
    if not ref.startswith("#/"):
        raise ValueError(f"unsupported $ref: {ref}")
    cur: Any = schema
    for part in ref[2:].split("/"):
        cur = cur[part]
    return cur


def type_name(value: Any) -> str:
    if value is None:
        return "null"
    if isinstance(value, bool):
        return "boolean"
    if isinstance(value, int) and not isinstance(value, bool):
        return "integer"
    if isinstance(value, float):
        return "number"
    if isinstance(value, str):
        return "string"
    if isinstance(value, list):
        return "array"
    if isinstance(value, dict):
        return "object"
    return type(value).__name__


def matches_type(value: Any, expected: str) -> bool:
    actual = type_name(value)
    if expected == "number":
        return actual in {"integer", "number"}
    if expected == "integer":
        return actual == "integer"
    return actual == expected


def apply_schema(
    schema: dict[str, Any], node: dict[str, Any], value: Any, path: str, errors: Errors
) -> None:
    node = resolve_ref(schema, node)
    expected_type = node.get("type")
    if expected_type and not matches_type(value, expected_type):
        errors.add(path, f"expected {expected_type}, got {type_name(value)}")
        return
    if "const" in node and value != node["const"]:
        errors.add(path, f"expected {dump(node['const'])}, got {dump(value)}")
        return
    if "enum" in node and value not in node["enum"]:
        errors.add(path, f"expected one of {dump(node['enum'])}, got {dump(value)}")
        return
    if isinstance(value, str) and "minLength" in node:
        if len(value) < node["minLength"] or value.strip() != value or not value.strip():
            errors.add(path, "must be a nonempty string without surrounding whitespace")
            return
    if isinstance(value, int) and not isinstance(value, bool):
        if "minimum" in node and value < node["minimum"]:
            errors.add(path, f"must be >= {node['minimum']}")
            return
    if isinstance(value, list):
        if "minItems" in node and len(value) < node["minItems"]:
            errors.add(path, f"must contain at least {node['minItems']} item(s)")
            return
        item_schema = node.get("items")
        if isinstance(item_schema, dict):
            for i, item in enumerate(value):
                apply_schema(schema, item_schema, item, f"{path}[{i}]", errors)
    if isinstance(value, dict):
        required = node.get("required", [])
        for key in required:
            if key not in value:
                errors.add(f"{path}.{key}" if path != "$" else key, "missing required field")
        properties = node.get("properties", {})
        additional = node.get("additionalProperties", True)
        for key, child in value.items():
            child_path = f"{path}.{key}" if path != "$" else key
            if key in properties:
                apply_schema(schema, properties[key], child, child_path, errors)
            elif additional is False:
                errors.add(child_path, "unknown field")


def validate_invariants(plan: dict[str, Any], mode: str, errors: Errors) -> None:
    stories = plan.get("userStories")
    if not isinstance(stories, list):
        return
    by_id: dict[str, tuple[int, int]] = {}
    passes_by_id: dict[str, bool] = {}
    by_priority: dict[int, int] = {}
    for index, story in enumerate(stories):
        if not isinstance(story, dict):
            continue
        path = f"userStories[{index}]"
        ident = story.get("id")
        priority = story.get("priority")
        expected_id = f"US-{index + 1:03d}"
        if isinstance(ident, str) and ident != expected_id:
            errors.add(f"{path}.id", f"expected {dump(expected_id)} for Story order")
        if isinstance(priority, int) and not isinstance(priority, bool) and priority != index + 1:
            errors.add(f"{path}.priority", f"expected {index + 1} for Story order")
        if isinstance(ident, str) and ident:
            if ident in by_id:
                errors.add(f"{path}.id", f"duplicate of userStories[{by_id[ident][0]}].id ({dump(ident)})")
            else:
                by_id[ident] = (index, priority if isinstance(priority, int) else -1)
                if isinstance(story.get("passes"), bool):
                    passes_by_id[ident] = story["passes"]
        if isinstance(priority, int) and not isinstance(priority, bool):
            if priority in by_priority:
                errors.add(
                    f"{path}.priority",
                    f"duplicate of userStories[{by_priority[priority]}].priority ({priority})",
                )
            else:
                by_priority[priority] = index
        if mode == "conversion":
            if story.get("passes") is not False:
                errors.add(f"{path}.passes", "conversion requires false")
            notes = story.get("notes")
            if notes != "":
                errors.add(f"{path}.notes", "conversion requires an empty string")

    for index, story in enumerate(stories):
        if not isinstance(story, dict):
            continue
        deps = story.get("dependencies")
        if not isinstance(deps, list):
            continue
        seen: set[str] = set()
        own_id = story.get("id")
        own_priority = story.get("priority")
        for dep_index, dep in enumerate(deps):
            dpath = f"userStories[{index}].dependencies[{dep_index}]"
            if not isinstance(dep, str):
                continue
            if dep in seen:
                errors.add(dpath, f"duplicate dependency {dump(dep)}")
                continue
            seen.add(dep)
            if dep == own_id:
                errors.add(dpath, f"{dump(dep)} cannot depend on itself")
                continue
            if dep not in by_id:
                errors.add(dpath, f"{dump(dep)} does not name an existing Story")
                continue
            if story.get("passes") is True and passes_by_id.get(dep) is False:
                errors.add(dpath, f"{dump(dep)} must pass before this Story can pass")
            dep_index_story, dep_priority = by_id[dep]
            if isinstance(own_priority, int) and isinstance(dep_priority, int) and dep_priority >= own_priority:
                errors.add(
                    dpath,
                    f"{dump(dep)} has priority {dep_priority}, which is not earlier than {own_priority}",
                )
            _ = dep_index_story


def load_json(path: Path) -> Any:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError:
        raise SystemExit(f"{path}: file not found")
    except json.JSONDecodeError as exc:
        raise SystemExit(f"{path}: invalid JSON: {exc}")


def validate(plan_path: Path, mode: str) -> list[str]:
    schema = json.loads(SCHEMA_PATH.read_text(encoding="utf-8"))
    plan = load_json(plan_path)
    errors = Errors()
    if not isinstance(plan, dict):
        errors.add("$", f"expected object, got {type_name(plan)}")
        return errors.items
    apply_schema(schema, schema, plan, "$", errors)
    if not errors.items:
        validate_invariants(plan, mode, errors)
    return errors.items


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(description="Validate a Ralph Plan")
    parser.add_argument("plan", nargs="?", help="path to prd.json")
    parser.add_argument(
        "--mode",
        choices=("conversion", "runtime"),
        default="conversion",
        help="conversion rejects passed Stories and notes; runtime accepts them",
    )
    args = parser.parse_args(argv)
    if not args.plan:
        print("Usage: validate-plan.py [--mode conversion|runtime] PATH", file=sys.stderr)
        return 1
    problems = validate(Path(args.plan), args.mode)
    if problems:
        print("invalid Ralph Plan:", file=sys.stderr)
        for item in problems:
            print(item, file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
