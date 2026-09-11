# Ralph

Ralph is a deterministic TypeScript runner: one process, one Target Repository, one Ralph Plan, fresh Luna implementation and review sessions, independent Checks, and engine-owned Story commits.

The Plan contract is multi-Story `schemaVersion: 1`; see [docs/plan/README.md](docs/plan/README.md).

## Skills

### `ralph-author-prd`

Converts an approved design document into a tracked, Luna-ready implementation PRD with ordered Stories, focused Checks, source coverage, dependencies, and explicit Plan boundaries. It writes only the draft PRD and does not implement work, create a Plan, or commit changes. See [skills/ralph-author-prd/SKILL.md](skills/ralph-author-prd/SKILL.md).

### `ralph-review-and-fix-prd`

Audits a completed draft PRD against its approved source, requested scope, Ralph contracts, and Target Repository. It summarizes semantic readiness findings, automatically repairs established defects in the PRD, and validates the result without an approval gate or Plan installation. See [skills/ralph-review-and-fix-prd/SKILL.md](skills/ralph-review-and-fix-prd/SKILL.md).

### `ralph-install-plan`

Mechanically validates an approved, tracked, unchanged PRD, compiles it into a conversion-ready Ralph Plan, and installs the Plan as ignored runtime state. If validation identifies an unambiguous mechanical PRD defect, it repairs only the PRD and stops for the corrected document to be reviewed and committed. See [skills/ralph-install-plan/SKILL.md](skills/ralph-install-plan/SKILL.md).

## Setup and commands

Ralph requires a supported Node version, Git, Bash, and an authenticated Codex CLI.

```text
npm install
npm run build
npm link

ralph run --repo PATH --plan PATH --iterations N
ralph prd validate --repo TARGET --from TRACKED-PRD.md
ralph prd install --repo TARGET --from TRACKED-PRD.md
ralph plan validate --mode conversion PATH
ralph plan validate --mode runtime PATH
ralph plan install --repo TARGET --from CANDIDATE.json
```

`prd validate` mechanically audits an approved, tracked, unchanged PRD against its Target Repository. `prd install` performs the same audit, compiles its executable fields into a conversion-ready Plan, and installs that Plan atomically. See [examples/plan.json](examples/plan.json) for a minimal conversion-ready Plan. Direct JSON validation and installation remain available for tooling.

`--repo`, `--plan`, and `--iterations` are required for a Run. The Plan must be `<Target Repository>/.ralph/plan.json`, and `--iterations` is the total Story-attempt budget. One Iteration contains one implementation session and one fresh review-and-repair session. Unknown, duplicate, and missing arguments are rejected.

Fixed Run settings are model `gpt-5.6-luna`, high reasoning, unrestricted Codex execution through `--dangerously-bypass-approvals-and-sandbox`, a 3600-second timeout per Luna session, and a 900-second timeout per Check. Codex runs with the invoking user's filesystem and network access; securing that execution environment is currently deferred.

## Behavior

For each Iteration, Ralph selects the earliest incomplete Story whose dependencies have passed. One fresh Luna session implements the Story, then a second fresh Luna session reviews and repairs the implementation for production design, names, comments and documentation, and test quality. The review session also runs when implementation leaves no diff, so it can verify that the existing implementation needs no Story-scoped repair. Ralph then runs the Story Checks. A failed implementation session, review session, or Check consumes the Iteration and retries that Story with its existing worktree changes. Successful changes are committed together as `ralph(<Story ID>): <Story title>`, then the Story is marked passed atomically. An already-satisfied Story is reviewed, checked, and marked passed without an empty commit.

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
    ├── plan.json
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
