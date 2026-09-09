---
name: ralph
description: Convert an approved implementation PRD into a validated multi-Story Ralph Plan.
---

# PRD-to-Plan conversion

Mechanically convert one approved, tracked implementation PRD into new ignored execution state at `<Target Repository>/.ralph/prd.json`. Do not implement Stories or run the Ralph Engine.

Required input:

- the approved PRD path;
- the Target Repository path;
- the Ralph Repository path containing `schema/`.

Resolve every path from these supplied repositories, never from the current working directory.

## Convert

1. **Validate the artifacts.** Confirm that both repositories are Git roots and the PRD is a tracked, unchanged file under `<Target Repository>/tasks/`. Read the PRD completely. Confirm its Branch equals the Target Repository's current branch. Completion: the exact approved PRD, Target, Ralph helper paths, and branch are unambiguous.
2. **Read the contracts.** Read `<Ralph Repository>/schema/README.md`, `prd-format.md`, and `story-readiness.md`. Completion: every PRD Story satisfies the shared readiness and format contracts; otherwise refuse and return it to PRD authoring.
3. **Map executable fields only.** Create one JSON object per PRD Story in the same order. Copy project, branch, description, Story IDs, titles, descriptions, acceptance criteria, Checks, references, dependencies, and priorities exactly. Map `Dependencies: None` and `Non-goals: None` to empty arrays. Set every `passes` to `false` and every `notes` to `""`.

   The Source field, source-coverage ledger, project-level non-goals, and Plan boundaries remain authoritative in the tracked PRD and are intentionally absent from executable JSON. A Plan boundary separates executable Plans; never convert deferred, manual, or conditional follow-on work into a Story.

   Completion: every executable PRD Story and field has exactly one corresponding Plan value, with no invented behavior.
4. **Create a temporary candidate outside the Target Repository.** Use `mktemp`, arrange cleanup on success or failure, and write schemaVersion `1` JSON. Completion: the candidate exists and the Target Plan is absent and untouched.
5. **Validate with the supplied Ralph Repository:**

   ```bash
   python3 <Ralph Repository>/schema/validate-plan.py --mode conversion <candidate.json>
   ```

   Completion: validation exits zero. On failure, report the exact errors and write no Target Plan.
6. **Check installation safety.** Confirm `/.ralph/` is ignored, `.ralph` is not a symlink, and `<Target Repository>/.ralph/prd.json` does not exist. Existing Plan state requires an explicit operator reset outside this skill. Completion: installation cannot overwrite or escape the Target Repository.
7. **Install atomically:**

   ```bash
   python3 <Ralph Repository>/schema/write-plan.py --repo <Target Repository> --from <candidate.json>
   ```

   Completion: the validated Plan exists at `<Target Repository>/.ralph/prd.json`, the temporary candidate is removed, and no tracked file changed.

## Guardrails

- Preserve the approved PRD and its ordering exactly.
- Leave branch creation, dependency preparation, Plan reset, engine execution, commits, and Plan progress updates to the operator or Ralph Engine.
- Return ambiguous, oversized, unverifiable, or forward-dependent Stories to PRD authoring rather than repairing their intent during conversion.
