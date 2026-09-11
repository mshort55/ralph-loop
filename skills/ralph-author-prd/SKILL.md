---
name: ralph-author-prd
description: Author a reviewable, Luna-ready Ralph implementation PRD from a user-approved design document.
---

# Ralph PRD Authoring

Convert one authoritative design document into a tracked, multi-Story implementation PRD. Do not redesign the feature, implement it, create Ralph state, or commit changes.

Required input:

- the approved design document path;
- the Target Repository path;
- the Ralph Repository path containing `docs/plan/` and `schema/`;
- the intended branch name, or permission to propose one for approval.

Resolve all paths from the supplied repositories, never from the current working directory. Before drafting, read the shared contracts from the supplied Ralph Repository:

- `<Ralph Repository>/docs/plan/story-readiness.md`
- `<Ralph Repository>/docs/plan/prd-format.md`
- `<Ralph Repository>/docs/plan/README.md`

## Phase 1: draft for approval

1. **Validate the inputs.** Confirm that the design document is readable, the Target and Ralph Repositories are Git repositories, and the Ralph Repository contains the shared contracts. Confirm the user treats the document as authoritative. Resolve the intended branch name or clearly label a proposed name for approval. Propose a unique date-prefixed Markdown path under `<Target Repository>/.ralph/prds/`. Confirm that the proposed PRD path is not ignored while `<Target Repository>/.ralph/plan.json` is ignored; otherwise report the repository-setup blocker and stop. Completion: all paths, the source's approval status, the branch name, and the tracked-PRD/runtime-state split are unambiguous.
2. **Read the entire source.** Inventory every requirement, invariant, non-goal, verification expectation, conditional phase, and manual gate in a source-coverage ledger. One ledger row represents one atomic obligation that can receive one disposition; split clauses that have different Stories or boundaries, or independently testable behavior. Completion: every normative source obligation has one ledger row.
3. **Ground the work in the Target Repository.** Read applicable `AGENTS.md` files, referenced designs, affected implementation and tests, and task configuration. Determine ownership, interfaces, existing verification, and exact root-level Check commands. Prefer repository evidence over questions. Completion: each Story can cite the source and relevant repository evidence.
4. **Resolve material uncertainty.** Surface contradictions, missing product or architecture decisions, unresolved ownership or failure semantics, and source assumptions disproved by the repository. Ask only questions that evidence cannot settle, then stop for answers. Do not silently choose among materially different behaviors.
5. **Build the implementation graph.** From repository evidence, inventory the smallest cohesive changes that can be implemented and verified before their successors. Phrase each node as one behavioral delta, then challenge every conjunction and list in that phrase: if two parts can produce distinct failing scenarios, they are separate nodes. Each node records exact production locations, one explicit setup or starting state, one action or trigger, one observable result mechanism, one focused test selector or command, and prerequisite nodes. A package, test file, lifecycle seam, or full-suite command alone is not a focused evidence target. Keep variations together only when they share that setup, action, and observation mechanism and can use one narrow table or test group; different lifecycle states, failure injections, actions, or observations are separate nodes even when one test function or abstraction could contain them. Mechanical caller edits needed only to keep the repository compiling belong to the node that forces them; caller behavior with separate evidence is another node. Recursively repeat this split test until no node contains two independently failing scenarios. Completion: every executable source obligation maps to at least one node and every node's focused evidence can pass before successor nodes are implemented.
6. **Derive Stories from the graph.** Create one Story per node unless separate nodes are inseparable. Nodes are inseparable only when implementing either alone would leave the repository uncompilable or its focused evidence unable to run; an incomplete feature or temporarily unused internal capability is not enough reason to merge them. Record the repository-grounded reason for every merge. Each Story must satisfy `story-readiness.md`, be credible for one `gpt-5.6-luna` high-reasoning Iteration, and depend only on earlier Stories. There is no preferred Story count: prefer another ordered dependency Story over merging independently verifiable nodes.
7. **Audit the Stories.** Rewrite every acceptance criterion as one condition and one observable result. Confirm that each Story maps to one graph node or one explicitly justified inseparable set, has one discriminating evidence target, and has one observable completion boundary. Perform a stop-after-this-Story audit using only existing behavior and predecessor Stories: every acceptance criterion must already be true, and the focused evidence and Checks must be runnable and green. Move, split, or reorder any criterion that needs a successor. Split any Story containing criteria with different setup/action/result mechanisms or independently runnable evidence. Review adjacent Stories for overlapping completion criteria and assign each behavior to the earliest Story that leaves the repository coherent. Completion: every Story is an independent verification unit and every multi-node Story has a recorded inseparability reason.
8. **Close source coverage.** Map every ledger row to one or more Story IDs, or classify it explicitly as a preserved non-goal or Plan boundary with its reason. If required verification depends on unavailable or nondeterministic external prerequisites, or exceeds one Iteration, keep feasible automated Checks on its Story and map the assembled or manual verification to a Plan boundary with exact commands, prerequisites, owner, and trigger. Nothing may be silently omitted.
9. **Present the draft for review.** Present the exact proposed output path, the complete PRD and coverage ledger following `prd-format.md`, and the review-only implementation graph with columns for node, behavior, production locations, setup or starting state, action or trigger, observable result and focused evidence, prerequisites, and Story ID. For every Story containing multiple nodes, include its inseparability reason. This review evidence is not part of the PRD to be published. Stop and request explicit approval of the draft and path. Do not write the PRD during this phase.

## Phase 2: publish the approved draft

Continue only after the user explicitly approves the current draft. If the source, repository evidence, or requested scope changed, return to Phase 1 and obtain approval for the revised draft.

Write the approved PRD to the exact approved path under `<Target Repository>/.ralph/prds/`. The published file must follow `prd-format.md` exactly and preserve the approved Story order, acceptance criteria, checks, references, dependencies, coverage ledger, and Plan boundaries.

Completion means that one PRD file exists at the reported path and no other file was changed.

## Guardrails

- Treat the source as authoritative requirements, not raw material for feature redesign.
- Do not modify the source document.
- Do not implement code, create or edit `.ralph/`, run the Ralph Engine, run git commits, or generate Ralph's JSON Plan.
- Do not weaken, infer away, or silently defer a source requirement to make a Story smaller.
- Preserve ordinary private helper names, helper visibility, and equivalent local layout as implementation choices unless the source or repository contract settles them. Do not invent a public or exported interface merely to remove incidental implementation choice.
- If repository-specific tooling is unavailable, inspect equivalent configuration and source directly and record the evidence used.
