---
name: ralph-install-plan
description: Install an approved, tracked implementation PRD as a Ralph Plan, repairing unambiguous mechanical PRD defects for review when validation blocks installation.
---

# Ralph Plan Installation

Install one approved, tracked implementation PRD as new ignored execution state at `<Target Repository>/.ralph/plan.json`. Ralph code owns mechanical validation, compilation, and installation. When validation exposes an unambiguous mechanical PRD defect, repair the PRD for user review instead of installing the Plan. Do not implement Stories or run the Ralph Engine.

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

   Ralph verifies the PRD's Git state, branch, structure, coverage mappings, references, Plan invariants, and installation safety.
3. **Handle the result.** If the command exits zero, completion means that the Plan exists at `<Target Repository>/.ralph/plan.json` and no tracked file changed. If it fails, leave the Plan absent, use the exact diagnostic to read the relevant Ralph contract and cited evidence, and classify the defect before editing anything:
   - For an environment, Git-state, installation-state, or Ralph implementation failure, report the diagnostic and change nothing.
   - For semantic ambiguity, Story sizing, unverifiable behavior, or any defect whose correction would choose or alter intent, report the diagnostic and return the PRD to authoring unchanged.
   - For a mechanical PRD defect with exactly one correction established by the applicable Ralph contract and authoritative source or repository evidence, update only the PRD. Inspect directly related occurrences of the demonstrated defect pattern because validation may stop at the first failure. Apply only corrections that preserve the approved meaning; leave every uncertain correction untouched.

   After changing the PRD, stop without installing. Present the exact diagnostic and resulting diff, confirm that the Plan remains absent and that the skill changed no other file, and ask the user to review and commit the PRD before invoking this skill again. The new commit is approval of the repaired PRD.

## Guardrails

- Treat Ralph's diagnostic as the validation source of truth; do not recreate its rules in the skill.
- Repair contract representation, never product or implementation intent. Do not weaken reference precision, remove coverage, or change Story behavior merely to satisfy validation.
- Do not edit the authoritative source, Target Repository implementation, Ralph code, or Plan while repairing a PRD.
- Do not stage or commit a repaired PRD. The user owns review, approval, and recommit before a fresh installation attempt.
- Leave branch creation, dependency preparation, Plan reset, engine execution, commits, and Plan progress updates to the operator or Ralph Engine.
- Return semantic ambiguity, oversized Stories, and unverifiable behavior to PRD authoring; Ralph code handles mechanical format and relationship validation.
