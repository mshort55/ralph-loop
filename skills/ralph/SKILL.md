---
name: ralph
description: Install an approved, tracked implementation PRD as a validated multi-Story Ralph Plan.
---

# PRD-to-Plan conversion

Install one approved, tracked implementation PRD as new ignored execution state at `<Target Repository>/.ralph/prd.json`. Ralph code owns mechanical validation, compilation, and installation. Do not implement Stories or run the Ralph Engine.

Required input:

- the approved PRD path;
- the Target Repository path;
- the Ralph Repository path containing built `dist/`, `docs/plan/`, and `schema/` artifacts.

Resolve every path from these supplied repositories, never from the current working directory.

## Install

1. **Resolve the artifacts.** Confirm the supplied Ralph Repository contains built `dist/` artifacts. Read the approved PRD completely and confirm it is the intended input. Completion: the PRD, Target Repository, and Ralph Repository paths are unambiguous.
2. **Install with the supplied Ralph Repository:**

   ```bash
   node <Ralph Repository>/dist/cli.js prd install --repo <Target Repository> --from <approved-prd.md>
   ```

   Ralph verifies the PRD's Git state, branch, structure, coverage mappings, references, Plan invariants, and installation safety. Completion: the command exits zero, the Plan exists at `<Target Repository>/.ralph/prd.json`, and no tracked file changed. On failure, report the exact diagnostic and leave the Target Plan absent.

## Guardrails

- Treat compiler diagnostics as PRD-authoring defects; do not repair intent during installation.
- Leave branch creation, dependency preparation, Plan reset, engine execution, commits, and Plan progress updates to the operator or Ralph Engine.
- Return semantic ambiguity, oversized Stories, and unverifiable behavior to PRD authoring; Ralph code handles mechanical format and relationship validation.
