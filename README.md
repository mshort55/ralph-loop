# Ralph

Ralph is a deterministic TypeScript runner: one process, one Target Repository, one Ralph Plan, fresh Codex Iterations, independent Checks, and engine-owned Story commits.

The Plan contract is multi-Story `schemaVersion: 1`; see [docs/plan/README.md](docs/plan/README.md).

## Setup and commands

Ralph requires a supported Node version, Git, Bash, `setpriv`, and an authenticated Codex CLI.

```text
npm install
npm run build
npm link

ralph run --repo PATH --plan PATH --iterations N
ralph plan validate --mode conversion PATH
ralph plan validate --mode runtime PATH
ralph plan install --repo TARGET --from CANDIDATE.json
```

See [examples/plan.json](examples/plan.json) for a minimal conversion-ready Plan.

`--repo`, `--plan`, and `--iterations` are required for a Run. The Plan must be `<Target Repository>/.ralph/prd.json`, and `--iterations` is the total Codex-call budget across all Stories. Unknown, duplicate, and missing arguments are rejected.

Fixed Run settings are model `gpt-5.6-luna`, high reasoning, automatic workspace review through `--approve-for-me`, a 3600-second Iteration timeout, and a 900-second timeout per Check. `setpriv` clears inherited and ambient capabilities before Codex starts.

## Behavior

For each Iteration, Ralph selects the earliest incomplete Story whose dependencies have passed. A failed Codex call or failed Check consumes an Iteration and retries that Story with its existing worktree changes. Successful changes are committed as `ralph(<Story ID>): <Story title>`, then the Story is marked passed atomically. An already-satisfied Story is marked passed without an empty commit.

Ralph exits zero when all Stories pass. Budget exhaustion exits nonzero while preserving commits, Plan progress, logs, and uncommitted attempts. Git and Plan invariant violations stop immediately. A later clean Run resumes from Plan state and reconciles an engine commit if a process stopped between committing and updating the Plan.

Checks are literal command strings and intentionally execute through `bash -lc` from the Target Repository root.

## Target Repository storage

```text
Target Repository/
├── AGENTS.md
└── .ralph/
    ├── .gitignore
    ├── prds/
    │   └── YYYY-MM-DD-feature.md
    ├── prd.json
    └── runs/<timestamp-pid>/
```

Use this tracked `.ralph/.gitignore` to retain PRD history while ignoring runtime state:

```gitignore
*
!.gitignore
!prds/
!prds/**
```

## Development

```text
npm test
npm run test:coverage
npm run check
```

The Vitest suite uses temporary Git repositories and a TypeScript fake Codex executable. It does not call the network or real Codex. Coverage thresholds are 100% for statements, branches, functions, and lines.

## Deferred

Automatic dirty-worktree recovery, remote/base handling, configurable Codex settings, Target Contracts, and other agent adapters remain out of scope.
