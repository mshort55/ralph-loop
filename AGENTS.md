# Ralph Agent Instructions

Ralph is a deterministic TypeScript engine that runs one Plan against one Target Repository.

## Commands

```text
npm run check
npm run build
node dist/cli.js run --repo PATH --plan PATH --iterations N
```

## Architecture

- `src/plan/` owns Plan validation, selection, installation, and atomic progress updates.
- `src/run/` owns the Run state machine and Iteration prompt construction.
- `src/system/` contains the Git, process, and lock adapters.
- `src/main.ts` owns command dispatch; `src/cli.ts` is executable wiring only.
- `docs/plan/` is the human-readable Plan contract; `schema/` is the machine-readable contract.

Test behavior through the CLI and the `PlanStore`, `TargetRepository`, `ProcessRunner`, and `runPlan` seams. Keep coverage at 100% for statements, branches, functions, and lines.

## Invariants

- Start on a prepared, clean, non-detached branch.
- Track PRDs under `.ralph/prds/`; ignore the Plan, locks, logs, and other runtime state.
- Codex does not commit, stage, switch branches, or modify the Plan.
- Ralph creates one engine-owned commit only after Checks pass.
- Checks remain literal Bash commands run independently from the Target Repository root.

Failed Checks, empty diffs, and Codex failures consume an Iteration. Invariant and commit failures stop immediately. A fresh ephemeral Codex process runs each Iteration while the worktree persists between attempts.
