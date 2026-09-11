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
- the intended branch name, if already known.

Resolve all paths from the supplied repositories, never from the current working directory. Before drafting, read the shared contracts from the supplied Ralph Repository:

- `<Ralph Repository>/docs/plan/story-readiness.md`
- `<Ralph Repository>/docs/plan/prd-format.md`
- `<Ralph Repository>/docs/plan/README.md`

## Workflow

1. **Validate the inputs.** Confirm that the design document is readable, the Target and Ralph Repositories are Git repositories, and the Ralph Repository contains the shared contracts. Confirm the user treats the document as authoritative. Resolve the intended branch name from the input, or derive a conventional branch name from the design and repository conventions. Select a unique date-prefixed Markdown path under `<Target Repository>/.ralph/prds/`. Confirm that the PRD path is not ignored while `<Target Repository>/.ralph/plan.json` is ignored; otherwise report the repository-setup blocker and stop. Completion: all paths, the source's approval status, the branch name, and the tracked-PRD/runtime-state split are unambiguous.
2. **Read the entire source.** Inventory every requirement, invariant, non-goal, verification expectation, conditional phase, and manual gate in a source-coverage ledger. One ledger row represents one atomic obligation that can receive one disposition; split clauses that have different Stories or boundaries, or independently testable behavior. Completion: every normative source obligation has one ledger row.
3. **Ground the work in the Target Repository.** Read applicable `AGENTS.md` files, referenced designs, affected implementation and tests, and task configuration. Determine ownership, interfaces, existing verification, and exact root-level Check commands. Prefer repository evidence over questions. Completion: each Story can cite the source and relevant repository evidence.
4. **Resolve material uncertainty.** Surface contradictions, missing product or architecture decisions, unresolved ownership or failure semantics, and source assumptions disproved by the repository. Ask only questions that evidence cannot settle, then stop for answers. Do not silently choose among materially different behaviors.
5. **Build the implementation graph.** From repository evidence, inventory the smallest cohesive production changes that can be implemented and verified before their successors. Phrase each node as one behavioral delta and record its exact production locations, setup or starting state, action or trigger, observable result mechanism, focused test selector or command, and prerequisites. A package, test file, lifecycle seam, or full-suite command alone is not a focused evidence target. Prefer small nodes suitable for one Luna Iteration, but treat success, failure, timeout, concurrency, and other test scenarios as evidence cases rather than automatic nodes. Scenarios may be separate nodes when each extends one settled design without invalidating predecessor behavior; keep them together when they collectively determine a contract, ownership transition, state representation, or synchronization design that must be implemented coherently. Mechanical caller edits needed only to keep the repository compiling belong to the node that forces them; caller behavior with a separate outcome or evidence target is another node. Completion: every executable source obligation maps to at least one node, every node's focused evidence can pass before its successors are implemented, and no node requires a temporary design that a successor must replace.
6. **Derive Stories from the graph.** Create one Story per node unless separate nodes are inseparable. Nodes are inseparable when implementing either alone would leave the repository uncompilable, prevent its focused evidence from running, or force an earlier Story to introduce a temporary API contract, ownership rule, state representation, or synchronization design that a successor must replace. An incomplete feature or temporarily unused internal capability is not by itself a reason to merge. Record the repository-grounded reason for every merge. Each Story must satisfy `story-readiness.md`, be credible for one `gpt-5.6-luna` high-reasoning Iteration, and depend only on earlier Stories. There is no preferred Story count: prefer another ordered dependency Story whenever its predecessor remains a correct, maintainable implementation without the successor.
7. **Audit the Stories.** Rewrite every acceptance criterion as one condition and one observable result. Confirm that each Story maps to one graph node or one explicitly justified inseparable set, has one discriminating evidence target, and has one observable completion boundary. Perform a stop-after-this-Story audit using only existing behavior and predecessor Stories: every acceptance criterion must already be true, the focused evidence and Checks must be runnable and green, and the resulting production design must remain valid without successor work. When scenarios are split across Stories, include in the earlier Story the settled successor constraints its implementation must preserve without requiring it to implement successor behavior. Move, split, merge, or reorder criteria when a Story needs a successor to become coherent or a successor would have to redesign it. Review adjacent Stories for overlapping completion criteria and assign each behavior to the earliest Story that leaves the repository coherent. Completion: every Story is an independent verification unit, every multi-node Story has a recorded inseparability reason, and every scenario split is an additive extension of a settled predecessor design.
8. **Close source coverage.** Map every ledger row to one or more Story IDs, or classify it explicitly as a preserved non-goal or Plan boundary with its reason. If required verification depends on unavailable or nondeterministic external prerequisites, or exceeds one Iteration, keep feasible automated Checks on its Story and map the assembled or manual verification to a Plan boundary with exact commands, prerequisites, owner, and trigger. Nothing may be silently omitted.
9. **Present the implementation graph.** Give the user a concise planning summary followed by the complete implementation graph with columns for node, behavior, production locations, setup or starting state, action or trigger, observable result and focused evidence, prerequisites, and Story ID. For every Story containing multiple nodes, include its inseparability reason. Treat this output as informational and continue directly to writing in the same run without requesting approval. Completion: the user has the summary and the complete graph.
10. **Write the PRD.** Write the completed PRD directly to the selected path under `<Target Repository>/.ralph/prds/`. The file must follow `prd-format.md` exactly and include the Story order, acceptance criteria, Checks, references, dependencies, coverage ledger, and Plan boundaries. Omit the implementation graph from the published PRD unless `prd-format.md` requires it. Completion: one PRD file exists at the reported path and no other file was changed.

After writing, report the PRD path, Story count, and any Plan boundaries. Do not reproduce the PRD, coverage ledger, or implementation graph again.

## Guardrails

- Treat the source as authoritative requirements, not raw material for feature redesign.
- Do not modify the source document.
- Limit file changes to the single PRD under `<Target Repository>/.ralph/prds/`. Leave the source document, implementation, Ralph runtime state, `.ralph/plan.json`, and Git history unchanged.
- Do not weaken, infer away, or silently defer a source requirement to make a Story smaller.
- Preserve ordinary private helper names, helper visibility, and equivalent local layout as implementation choices unless the source or repository contract settles them. Do not invent a public or exported interface merely to remove incidental implementation choice.
- If repository-specific tooling is unavailable, inspect equivalent configuration and source directly and record the evidence used.
