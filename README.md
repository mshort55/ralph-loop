# Ralph

The Ralph Engine is a deterministic runner: one process, one Target Repository, one Ralph Plan, fresh Codex Iterations, independent Checks, and engine-owned Story commits.

The Plan contract is multi-Story `schemaVersion: 1`. See [schema/README.md](schema/README.md). Do not duplicate that schema here.

Canonical terms: Iteration, Plan, Story, Check, machine-complete, and invariant violation.

## Interface

```bash
./ralph.sh run --repo PATH --plan PATH --iterations N
```

`--repo`, `--plan`, and `--iterations` are required. The Plan must be `<Target Repository>/.ralph/prd.json`; both paths are explicit and canonicalized. `--iterations` is a positive integer and is the total Codex-call budget across all Stories, not a Story limit. Unknown, duplicate, or missing arguments are rejected. There are no flags for model, permissions, or timeouts.

Fixed POC settings live in `ralph.sh`:

- model: `gpt-5.6-luna`
- reasoning effort: `high`
- sandbox and approval review: automatic `workspace-write` review via `--approve-for-me`
- inherited and ambient process capabilities: cleared before Codex starts
- Iteration timeout: 3600 seconds
- Check timeout: 900 seconds per Check

## Plan

Author Stories through the PRD skill and convert them with the Ralph converter. The Plan is ignored mutable state at `.ralph/prd.json`. Required fields, uniqueness, dependency order, conversion `passes`/`notes` rules, and runtime validation live only in [schema/README.md](schema/README.md).

`checks` are nonempty literal Target Repository-root commands. Ralph performs no substitution or inference.

For each Iteration, Ralph selects the earliest incomplete Story whose dependencies have passed. A failed Codex call or failed Check consumes an Iteration and retries that Story with its existing worktree changes. A successful Story is committed, marked passed atomically, and followed by the next ready Story while budget remains.

## Layout

```text
ralph/
├── ralph.sh                    deterministic loop
├── prompt.md                   instructions for one Story
└── tests/run-fixtures.sh       local fixture harness (fake Codex)

Target Repository/
├── AGENTS.md
└── .ralph/                     ignored local inputs and logs
    ├── prd.json
    └── runs/<timestamp-pid>/
        ├── iteration-001-US-001.jsonl
        ├── iteration-001-US-001-checks.log
        └── ...
```

## Operator preparation

Before starting a Run, the operator:

1. creates and checks out the intended branch;
2. prepares dependencies and other environment prerequisites;
3. leaves a clean worktree and empty index;
4. ignores `/.ralph/`;
5. writes the Plan; and
6. confirms Checks work from the repository root.

Ralph does not fetch, create branches, install dependencies, repair the environment, merge, push, or clean the worktree. A later clean Run continues from `passes` state. If a process stops after an engine commit but before its Plan update, the next Run reconciles the commit's `Ralph-Story` trailer.

## Run outcome

When a Story's Checks pass, Ralph stages the complete change, commits it as `ralph(<Story ID>): <Story title>`, marks that Story passed, and continues while Iterations remain. An already-satisfied Story is marked passed without an empty commit.

Ralph exits zero when all Stories pass. Budget exhaustion with incomplete Stories exits nonzero while preserving completed commits, Plan progress, logs, and any uncommitted attempt. Git or Plan invariant violations stop immediately.

## Fixtures

```bash
./tests/run-fixtures.sh
```

The harness uses temporary Git repositories and a fake `codex` executable. It does not call the network or real Codex.

## Deferred

Automatic dirty-worktree recovery, remote/base handling, configurable Codex settings, Target Contracts, and other agent adapters are out of scope.
