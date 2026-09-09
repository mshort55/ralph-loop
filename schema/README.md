# Ralph Plan contract (`schemaVersion: 1`)

PRD authoring uses these shared references:

- `prd-format.md` defines the reviewed Markdown input format.
- `story-readiness.md` defines the minimum executable Story contract.

Authoritative multi-Story contract for PRD authoring, conversion, validation, and the Ralph Engine. Skills describe workflow only; they do not restate this schema.

Canonical terms: Target Repository, Run, Iteration, PRD, Ralph Plan, Story, Check, machine-complete, invariant violation.

## Artifacts

1. Approved source design — unchanged input.
2. Tracked derived PRD — Markdown under the Target Repository `tasks/` directory.
3. Ralph Plan — ignored mutable execution state at `.ralph/prd.json`.

## Shape

See [ralph-plan.schema.json](./ralph-plan.schema.json) for structural constraints. Cross-Story rules live in [validate-plan.py](./validate-plan.py).

Required nonempty strings: `project`, `branchName`, `description`, and every Story `id`, `title`, and `description`. Required nonempty string arrays: `acceptanceCriteria`, `checks`, and `references`. `nonGoals` and `dependencies` may be empty. `checks` are exact Target Repository-root commands.

## Invariants

- Story IDs are continuous and match array order: `US-001` through `US-NNN`.
- Story priorities are continuous and match array order: `1` through `N`.
- Each dependency names an existing Story whose priority is strictly earlier (smaller). Missing, duplicate-in-list, self, forward, and cyclic dependencies are invalid.
- A passed Story may not have an incomplete dependency.
- Conversion mode (`--mode conversion`): every `passes` is `false` and every `notes` is `""`.
- Runtime mode (`--mode runtime`): previously passed Stories and accumulated notes are accepted.

## Validator

```bash
python3 schema/validate-plan.py --mode conversion PATH
python3 schema/validate-plan.py --mode runtime PATH
python3 schema/write-plan.py --repo TARGET --from CANDIDATE.json
```

`--mode conversion` is the default. Failure prints the exact field or relationship and writes no Plan file. `write-plan.py` runs conversion validation, requires `/.ralph/` to be ignored, and installs `.ralph/prd.json` atomically. The converter and engine must call this validator; neither invents a second contract.

`write-plan.py` creates a new Plan and refuses to replace existing execution state. `update-plan.py` is engine-owned: after Checks pass, it atomically marks exactly one ready Story passed while protecting the expected Plan hash.
