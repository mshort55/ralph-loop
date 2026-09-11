# Story readiness

A Story is ready only when every criterion below is true.

## Ready Story criteria

- **One observable outcome:** the Story delivers one independently verifiable behavior or repository capability.
- **Settled contract:** observable behavior, ownership, interfaces, failure semantics, and relevant invariants are explicit.
- **Bounded change:** the outcome is achievable by `gpt-5.6-luna` with high reasoning in one Iteration, including implementation and review, without rediscovering the design.
- **Ordered dependencies:** every prerequisite is an earlier Story, existing repository behavior, or an explicit external precondition.
- **Complete acceptance criteria:** criteria state observable success and important failure or edge behavior without prescribing incidental implementation details.
- **Executable checks:** Checks are exact Target Repository-root commands that are relevant and feasible in the Iteration. Verification requiring unavailable or nondeterministic prerequisites is a Plan boundary.
- **Traceable evidence:** references identify exact source sections and relevant Target Repository paths. Every covered source requirement appears in the PRD coverage ledger.
- **Explicit boundaries:** non-goals, manual work, environmental gates, and deferred or conditional phases are named.
- **No hidden ambiguity:** the Iteration may choose private names and local layout, but not product behavior, module seams, ownership, public interfaces, or error policy.

## Split or clarification triggers

Split a Story when it contains independently useful outcomes, unrelated ownership areas, separate lifecycle paths, a conditional follow-on phase, or more verification than fits one Iteration.

Ask for clarification when source and repository evidence cannot settle behavior, ownership, interface shape, error semantics, scope, or a dependency. If readiness is doubtful, split the Story or clarify it.
