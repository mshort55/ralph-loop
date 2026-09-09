# Story readiness

This is the readiness contract for Stories produced for Ralph. A Story is ready only when every item below is true.

## Ready Story criteria

- **One observable outcome:** the Story delivers one independently verifiable behavior or repository capability.
- **Settled contract:** externally observable behavior, ownership, interfaces, failure semantics, and relevant invariants are explicit. No product or architecture decision remains for the Iteration.
- **Bounded change:** the outcome is plausibly achievable by `gpt-5.6-luna` with high reasoning in one Iteration without rediscovering the design. Prefer one cohesive seam or lifecycle path.
- **Ordered dependencies:** every prerequisite is an earlier Story, existing repository behavior, or an explicit external precondition. The Story never depends on a later Story.
- **Complete acceptance criteria:** criteria state observable success and important failure or edge behavior without prescribing incidental implementation details.
- **Executable checks:** Checks are exact commands runnable from the Target Repository root. Each command is relevant to the Story and expected to be feasible in its Iteration. Required verification that depends on unavailable or nondeterministic external prerequisites, or exceeds one Iteration, is an explicit Plan boundary rather than an impossible Story Check.
- **Traceable evidence:** References identify exact source sections and relevant Target Repository paths. Every source requirement covered by the Story is visible in the PRD coverage ledger.
- **Explicit boundaries:** non-goals, manual work, environmental gates, and deferred or conditional phases are named rather than implied.
- **No hidden ambiguity:** the Iteration may choose ordinary private names and local layout, but not product behavior, architecture boundaries, ownership, public interfaces, or error policy.

## Mandatory split or clarification triggers

Split the Story when it contains independently useful outcomes, unrelated ownership areas, separate lifecycle paths, a conditional follow-on phase, or more verification than is credible in one Iteration.

Ask the user for clarification when source and repository evidence cannot settle behavior, ownership, interface shape, error semantics, scope, or a dependency. Do not disguise an unresolved decision as an acceptance criterion.

If readiness is doubtful, split the Story or clarify it. Do not rely on a hoped-for large Iteration.
