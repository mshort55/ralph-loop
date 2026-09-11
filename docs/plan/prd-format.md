# Implementation PRD format

The PRD is a human-reviewed input to Ralph's mechanical Plan conversion. Preserve the section names and field labels below.

```markdown
# PRD: <Project>

## Project
<name>

## Branch
<branch name>

## Source
<approved design document path>

## Description
<implementation objective and repository-grounded context>

## Source coverage

| Source item | Disposition | Story or boundary |
| --- | --- | --- |
| <path § heading: concise requirement> | Story | US-001 |
| <path § heading: concise non-goal> | Preserved non-goal | Project |
| <path § heading: conditional/manual work> | Plan boundary | PB-001 |

## Stories

### US-001: <observable outcome>

**Priority:** 1
**Dependencies:** None

**Description**
<what changes, where ownership lies, and the settled behavior>

**Acceptance criteria**

- [ ] <observable success, failure, or edge behavior>

**Non-goals**

- <work explicitly outside this Story>

**Checks**

- `<exact command from the Target Repository root>`

**References**

- Source: `<source path> § <heading>`
- Repository: `<Target Repository-relative path>`

## Plan boundaries

### PB-001: <manual, deferred, or conditional boundary>

**Disposition:** <manual gate | deferred PRD | conditional follow-on>
**Reason:** <why this is not an executable Story in this PRD>
**Source:** `<source path> § <heading>`
**Command:** `<exact command, or None when no command applies>`
**Prerequisites:** <environmental or external prerequisites, or None>
**Trigger or owner:** <condition and responsible party, when applicable>
```

## Format rules

- Use continuous Story IDs in execution order: `US-001`, `US-002`, and so on.
- Priority must match Story order. Dependencies may name only earlier Story IDs.
- Use `None` when a Story has no dependencies or non-goals; during conversion both map to empty JSON arrays.
- Use `None` as the complete `Plan boundaries` content when no boundaries apply.
- Checks must be exact commands, not prose such as "run the tests."
- Source references use the design document path and heading. Repository references are relative to the Target Repository root.
- Every atomic normative source obligation receives a coverage-ledger row. Split clauses when they have different dispositions or independently testable behavior. Multiple rows may map to one Story, and one row may map to multiple Stories.
- Allowed dispositions are `Story`, `Preserved non-goal`, and `Plan boundary`. Every Plan boundary must have a matching `PB-###` section.
- A Plan boundary ends the current executable Plan. Work after that boundary requires a separately approved PRD and Plan when its trigger is satisfied.
- The PRD contains implementation scope and verification, not iteration history or generated Ralph state.
- Before conversion, the PRD must be tracked and unchanged under the Target Repository's `.ralph/prds/` directory. Its Branch must equal the current branch, each Story must have Source and Repository references, referenced paths must exist, and a Source reference containing ` § ` must name an existing Markdown heading.
