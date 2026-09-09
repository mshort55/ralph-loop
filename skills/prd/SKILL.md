---
name: prd
description: Convert a user-approved design document into a reviewable, Luna-ready implementation PRD for Ralph.
---

# Design-to-PRD

Convert one authoritative design document into a tracked, multi-Story implementation PRD. Do not redesign the feature, implement it, create Ralph state, or commit changes.

Required input:

- the approved design document path;
- the Target Repository path;
- the intended branch name, or permission to propose one for approval.

Resolve all paths from the supplied repositories, never from the current working directory. Before drafting, read the shared contracts relative to this file:

- `../../schema/story-readiness.md`
- `../../schema/prd-format.md`
- `../../schema/README.md`

## Phase 1: draft for approval

1. **Validate the inputs.** Confirm that the design document is readable, the Target Repository is a Git repository, and the user treats the document as authoritative. Resolve the intended branch name or clearly label a proposed name for approval. Completion: both paths, the source's approval status, and the branch name are unambiguous.
2. **Read the entire source.** Inventory every requirement, invariant, non-goal, verification expectation, conditional phase, and manual gate in a source-coverage ledger. One ledger row represents one atomic obligation that can receive one disposition; split clauses that have different Stories or boundaries, or independently testable behavior. Completion: every normative source obligation has one ledger row.
3. **Ground the work in the Target Repository.** Read applicable `AGENTS.md` files, referenced designs, affected implementation and tests, and task configuration. Determine ownership, interfaces, existing verification, and exact root-level Check commands. Prefer repository evidence over questions. Completion: each Story can cite the source and relevant repository evidence.
4. **Resolve material uncertainty.** Surface contradictions, missing product or architecture decisions, unresolved ownership or failure semantics, and source assumptions disproved by the repository. Ask only questions that evidence cannot settle, then stop for answers. Do not silently choose among materially different behaviors.
5. **Decompose into Stories.** Each Story must satisfy every rule in `story-readiness.md` and be credible for one `gpt-5.6-luna` high-reasoning Ralph Iteration. Dependencies may point only to earlier Stories. Split independent outcomes, conditional work, and oversized changes; do not copy source headings mechanically. Each Story must deliver one observable repository capability through one cohesive change and one focused verification path.
6. **Audit Stories as independent verification units.** First rewrite every acceptance criterion as one condition and one observable result; separate behaviors that can fail independently instead of joining them in one bullet. Group criteria in one Story only when they share the same implementation cause, form one cohesive repository change, and can be established by one focused verification path. Split a group when any subset can be implemented and verified independently, has different prerequisites, or remains useful without the rest. For each Story, privately sketch the Iteration's feedback loop: the failing test or other observable evidence, the smallest cohesive implementation, and the focused Check that proves the outcome. Split the Story if that sketch contains multiple independent feedback loops or requires the Iteration to rediscover how responsibilities should be divided. Review adjacent Stories for overlapping completion criteria and assign each behavior to the earliest Story that can leave the repository coherent. Completion: every Story is one independent verification unit with atomic criteria and a single observable completion boundary.
7. **Close source coverage.** Map every ledger row to one or more Story IDs, or classify it explicitly as a preserved non-goal or Plan boundary with its reason. If required verification depends on unavailable or nondeterministic external prerequisites, or exceeds one Iteration, keep feasible automated Checks on its Story and map the assembled or manual verification to a Plan boundary with exact commands, prerequisites, owner, and trigger. Nothing may be silently omitted.
8. **Present the exact proposed output path, complete PRD, and coverage ledger to the user.** Follow `prd-format.md`. Stop and request explicit approval of that draft and path. Do not write the PRD during this phase.

## Phase 2: publish the approved draft

Continue only after the user explicitly approves the current draft. If the source, repository evidence, or requested scope changed, return to Phase 1 and obtain approval for the revised draft.

Write the approved PRD to the exact approved path under `<Target Repository>/tasks/`. The published file must follow `prd-format.md` exactly and preserve the approved Story order, acceptance criteria, checks, references, dependencies, coverage ledger, and Plan boundaries.

Completion means that one PRD file exists at the reported path and no other file was changed.

## Guardrails

- Treat the source as authoritative requirements, not raw material for feature redesign.
- Do not modify the source document.
- Do not implement code, create or edit `.ralph/`, invoke the Ralph Iteration skill, run git commits, or generate Ralph's JSON Plan.
- Do not weaken, infer away, or silently defer a source requirement to make a Story smaller.
- Preserve ordinary private helper names, helper visibility, and equivalent local layout as implementation choices unless the source or repository contract settles them. Do not invent a public or exported interface merely to remove incidental implementation choice.
- If repository-specific tooling is unavailable, inspect equivalent configuration and source directly and record the evidence used.
