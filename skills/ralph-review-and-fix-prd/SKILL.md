---
name: ralph-review-and-fix-prd
description: Review and automatically repair a completed draft Ralph implementation PRD before approval and Plan installation.
---

# Ralph PRD Review and Fix

Audit one completed draft implementation PRD from its source artifacts, summarize the findings, and immediately repair well-founded defects. This is the semantic complement to Ralph's mechanical validation. Do not implement Stories, install or modify a Plan, or commit changes.

Required input:

- the draft PRD path;
- the approved design document path and any explicit user scope constraints;
- the Target Repository path;
- the Ralph Repository path containing built `dist/`, `docs/plan/`, and `schema/` artifacts.

Resolve every path from the supplied repositories, never from the current working directory. Run this workflow after PRD authoring and before the user approves and commits the PRD for Plan installation.

## Workflow

1. **Establish review state.** Confirm the PRD and approved source are readable and the Target and Ralph Repositories are Git repositories. Read the Ralph contracts completely:
   - `<Ralph Repository>/docs/plan/story-readiness.md`
   - `<Ralph Repository>/docs/plan/prd-format.md`
   - `<Ralph Repository>/docs/plan/README.md`

   Read applicable Target Repository `AGENTS.md` files. Confirm `<Target Repository>/.ralph/plan.json` is absent; installed execution state is a blocker because this skill does not remove or rewrite Plans. Completion: the authoritative source, requested scope, repositories, draft, contracts, and safe repair state are unambiguous.
2. **Audit adversarially.** Reconstruct the implementation seams from the source and repository before judging the PRD. Check:
   - **Source fidelity:** every unique normative obligation has the correct Story, preserved non-goal, or Plan-boundary disposition; requested exclusions and conditional work remain outside executable Stories.
   - **Stop-after-Story coherence:** after each Story and its predecessors, its criteria and Checks can be true, the repository has a correct maintainable design, and successors extend rather than replace its interface, ownership, state, synchronization, or caller migration.
   - **Luna readiness:** a fresh `gpt-5.6-luna` high-reasoning Iteration can implement the Story from its own fields and references without successor-only knowledge or unrelated production changes.
   - **Dependencies and overlap:** every semantic prerequisite is present, incidental ordering is not encoded as dependency, and behavior or caller migration is not claimed by multiple Stories.
   - **Evidence:** focused Checks discriminate the claimed behavior, broad Checks are proportionate, repository-native formatting and verification are represented, references are sufficient, and environmental verification is an explicit Plan boundary.
   - **Execution cost:** minimum Iterations, repeated broad Checks, long dependency chains, oversized behavior clusters, repeated edits to the same production seam, and likely evidence-only or already-satisfied Stories are reported as judgment signals rather than fixed limits.

   Each finding names the affected Story or boundary IDs, cites source and repository evidence, explains the Ralph execution consequence, and gives the smallest correction direction. Preferences without a demonstrated readiness or fidelity consequence are omitted.
3. **Triage the findings.** Verify each finding against the raw artifacts. Classify it as a defect with a source-grounded correction, an environment problem outside the PRD, or unresolved intent. Determine repairs from the approved source and repository evidence rather than preference. Continue with all established repairs; leave only genuinely ambiguous findings unchanged.
4. **Summarize before repair.** Give the user a concise commentary update containing the verdict, finding count by severity, principal Story or boundary corrections, environment problems, and any unresolved intent. Continue immediately to repair without requesting approval.
5. **Repair the PRD.** Edit only the supplied PRD. Apply every established semantic and representational correction, including Story splitting, merging, reordering, dependency updates, acceptance-criterion movement, Check correction, coverage remapping, and Plan-boundary correction when the evidence requires it. Preserve source intent and explicit user scope. Renumber Story and boundary IDs and update every reference consistently when structure changes. Completion: the revised PRD has complete source coverage and every Story passes the stop-after-Story and Luna-readiness standards.
6. **Validate and verify.** Use the supplied Ralph Repository's code to compile the revised PRD and validate its conversion-ready Plan shape without installing it. Recheck source headings, repository paths, continuous IDs and priorities, dependencies, coverage targets, and the PRD diff. Repeat the adversarial audit against the repaired artifact. Apply one additional repair pass for any newly demonstrated, unambiguous defect and repeat mechanical validation. Stop after at most two repair passes; report any remaining issue instead of entering an unbounded review loop.
7. **Report the result.** Report the PRD path, original and final Story counts, repaired findings, validation performed, remaining cautions or unresolved intent, and confirmation that no other file changed. Do not reproduce the complete PRD or coverage ledger.

## Guardrails

- Treat the approved source and explicit user scope as authoritative; review improves execution readiness without redesigning the feature.
- Limit edits to the single draft PRD. Do not change the source, Target Repository implementation, Ralph code, `.ralph/plan.json`, or Git history.
- Do not stage or commit the repaired PRD. The user controls approval and subsequent Plan installation, but this workflow has no intermediate approval gate.
- Do not silently choose among materially different product behavior, ownership, interface, or error semantics. Repair all other established defects before reporting that ambiguity.
- Treat Ralph code as the source of truth for mechanical validation. Do not duplicate its parser or Plan relationship rules in prose or ad hoc scripts.
