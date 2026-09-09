# Ralph Agent Instructions

Ralph is a deterministic engine in this repository. It runs one Plan against one Target Repository.

## Commands

```bash
./ralph.sh run --repo PATH --plan PATH --iterations N
./tests/run-fixtures.sh
```

## Key files

- `ralph.sh` — loop, Git invariants, Checks, engine-owned commit
- `prompt.md` — Iteration instructions (implementation only; Ralph owns Git and the Plan)
- `tests/run-fixtures.sh` — five-group fixture harness with fake Codex

## Invariants

- Prepared, clean, non-detached branch before Codex runs
- `.ralph/` ignored
- Codex must not commit, stage, or switch branches
- The Plan file must not change during a Run
- One engine-owned commit only after Checks pass

## Patterns

- Fresh ephemeral Codex per Iteration; worktree is preserved between attempts
- Checks are literal commands from the Plan, run independently from the repository root
- Failed Checks, empty diffs, and Codex failures consume an Iteration; invariant and commit failures stop immediately
- Do not add resume, configurable Codex flags, or multi-Story Plans to this POC
