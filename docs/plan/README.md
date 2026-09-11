# Ralph Plan contract (`schemaVersion: 1`)

PRD authoring uses [prd-format.md](prd-format.md) and [story-readiness.md](story-readiness.md). This document is the authoritative multi-Story contract for PRD authoring, conversion, validation, and the Ralph Engine. Skills describe workflow only.

Canonical terms: Target Repository, Run, Iteration, PRD, Ralph Plan, Story, Check, machine-complete, invariant violation.

## Artifacts

1. Approved source design — unchanged input.
2. Tracked derived PRD history — Markdown under the Target Repository `.ralph/prds/` directory.
3. Ralph Plan — ignored mutable execution state at `.ralph/prd.json`.

## Shape

See [ralph-plan.schema.json](../../schema/ralph-plan.schema.json) for structural constraints. Cross-Story rules live in `src/plan/validate.ts`.

See [examples/plan.json](../../examples/plan.json) for a minimal conversion-ready document.

Required nonempty strings are `project`, `branchName`, `description`, and every Story `id`, `title`, and `description`. Required nonempty string arrays are `acceptanceCriteria`, `checks`, and `references`. `nonGoals` and `dependencies` may be empty. Checks are exact Target Repository-root commands.

## Invariants

- Story IDs are continuous and match array order: `US-001` through `US-NNN`.
- Story priorities are continuous and match array order: `1` through `N`.
- Each dependency names an existing Story whose priority is strictly earlier. Missing, duplicate-in-list, self, forward, and cyclic dependencies are invalid.
- A passed Story may not have an incomplete dependency.
- Conversion mode requires every `passes` to be `false` and every `notes` to be `""`.
- Runtime mode accepts previously passed Stories and accumulated notes.

## Commands

```text
ralph plan validate --mode conversion PATH
ralph plan validate --mode runtime PATH
ralph plan install --repo TARGET --from CANDIDATE.json
ralph prd validate --repo TARGET --from TRACKED-PRD.md
ralph prd install --repo TARGET --from TRACKED-PRD.md
```

Conversion mode is the default. Failure identifies the invalid field or relationship and writes no Plan. Installation validates the candidate, requires `.ralph/prd.json` to be ignored, writes atomically, and refuses to replace existing execution state. Story completion is engine-owned and protects the expected Plan digest.

PRD validation requires an approved Markdown PRD under the Target Repository's `.ralph/prds/` directory. The PRD must be tracked, unchanged, and name the current branch. Ralph validates its prescribed structure, coverage targets, Plan boundary fields, and Source and Repository references. Source reference headings are checked when a reference contains ` § `. PRD installation compiles the validated Markdown directly; no model performs the field mapping.
