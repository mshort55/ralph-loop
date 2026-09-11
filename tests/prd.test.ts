import { execFileSync } from "node:child_process";
import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { compilePrd, PrdCompiler } from "../src/prd/compiler.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

function prd(options: { boundary?: boolean; second?: boolean } = {}): string {
  const secondCoverage = options.second
    ? "\n| `design.md § Outcome: second behavior` | Story | US-002 |"
    : "";
  const boundaryCoverage = options.boundary
    ? "\n| `design.md § Later: deferred behavior` | Plan boundary | PB-001 |"
    : "";
  const secondStory = options.second
    ? `

### US-002: Second outcome

**Priority:** 2
**Dependencies:** US-001

**Description**
Second behavior.

**Acceptance criteria**

- [ ] Second behavior is visible

**Non-goals**

- Unrelated behavior

**Checks**

- \`npm test -- second\`

**References**

- Source: \`design.md § Outcome\`
- Repository: \`README.md\``
    : "";
  const boundaries = options.boundary
    ? `### PB-001: Deferred rollout

**Disposition:** deferred PRD
**Reason:** Requires another approval
**Source:** \`design.md § Later\`
**Command:** None
**Prerequisites:** None
**Trigger or owner:** Product owner`
    : "None";
  return `# PRD: Fixture

## Project
Fixture

## Branch
main

## Source
\`design.md\`

## Description
Deliver the fixture outcome.

## Source coverage

| Source item | Disposition | Story or boundary |
| --- | --- | --- |
| \`design.md § Outcome: first behavior\` | Story | US-001 |${secondCoverage}${boundaryCoverage}
| \`design.md § Non-goals: excluded behavior\` | Preserved non-goal | Project |

## Stories

### US-001: First outcome

**Priority:** 1
**Dependencies:** None

**Description**
First behavior.

**Acceptance criteria**

- [ ] First behavior is visible

**Non-goals**

None

**Checks**

- \`npm test -- first\`

**References**

- Source: \`design.md § Outcome\`
- Repository: \`README.md\`${secondStory}

## Plan boundaries

${boundaries}
`;
}

async function repository(
  source = prd(),
  design = "# Design\n\n## Outcome\n\n## Later\n",
) {
  const root = await mkdtemp(join(tmpdir(), "ralph-prd-test-"));
  roots.push(root);
  execFileSync("git", ["init", "-q", "-b", "main", root]);
  execFileSync("git", ["-C", root, "config", "user.name", "Fixture"]);
  execFileSync("git", ["-C", root, "config", "user.email", "fixture@test"]);
  await mkdir(join(root, ".ralph", "prds"), { recursive: true });
  await writeFile(
    join(root, ".ralph", ".gitignore"),
    "*\n!.gitignore\n!prds/\n!prds/**\n",
  );
  await writeFile(join(root, "design.md"), design);
  await writeFile(join(root, "README.md"), "fixture\n");
  const path = join(root, ".ralph", "prds", "2026-09-11-fixture.md");
  await writeFile(path, source);
  execFileSync("git", ["-C", root, "add", "."]);
  execFileSync("git", ["-C", root, "commit", "-q", "-m", "add PRD"]);
  return { root, path };
}

describe("compilePrd", () => {
  it("compiles the documented Markdown format without inventing Plan state", async () => {
    const plan = await compilePrd(prd({ boundary: true, second: true }));
    expect(plan).toEqual({
      schemaVersion: 1,
      project: "Fixture",
      branchName: "main",
      description: "Deliver the fixture outcome.",
      userStories: [
        {
          id: "US-001",
          title: "First outcome",
          description: "First behavior.",
          acceptanceCriteria: ["First behavior is visible"],
          nonGoals: [],
          checks: ["npm test -- first"],
          references: ["Source: design.md § Outcome", "Repository: README.md"],
          dependencies: [],
          priority: 1,
          passes: false,
          notes: "",
        },
        {
          id: "US-002",
          title: "Second outcome",
          description: "Second behavior.",
          acceptanceCriteria: ["Second behavior is visible"],
          nonGoals: ["Unrelated behavior"],
          checks: ["npm test -- second"],
          references: ["Source: design.md § Outcome", "Repository: README.md"],
          dependencies: ["US-001"],
          priority: 2,
          passes: false,
          notes: "",
        },
      ],
    });
  });

  it("preserves colons in Story titles", async () => {
    const plan = await compilePrd(
      prd().replace("First outcome", "First outcome: detailed"),
    );
    expect(plan.userStories[0]!.title).toBe("First outcome: detailed");
  });

  it.each([
    ["title", (value: string) => value.replace("# PRD:", "# Wrong:")],
    [
      "content",
      (value: string) => value.replace("\n## Project", "\nstray\n## Project"),
    ],
    [
      "unknown section",
      (value: string) => value.replace("## Project", "## Unknown"),
    ],
    [
      "duplicate section",
      (value: string) => value.replace("## Branch", "## Project"),
    ],
    [
      "missing section",
      (value: string) => value.replace("## Branch", "### Branch"),
    ],
    [
      "empty field",
      (value: string) => value.replace("Fixture\n\n## Branch", "\n## Branch"),
    ],
    [
      "project mismatch",
      (value: string) => value.replace("# PRD: Fixture", "# PRD: Other"),
    ],
    [
      "no Stories",
      (value: string) =>
        value.replace(
          /## Stories[\s\S]*?## Plan boundaries/,
          "## Stories\n\n## Plan boundaries",
        ),
    ],
    [
      "missing metadata",
      (value: string) => value.replace("**Priority:** 1", ""),
    ],
    [
      "missing dependencies",
      (value: string) => value.replace("**Dependencies:** None", ""),
    ],
    [
      "invalid priority",
      (value: string) => value.replace("**Priority:** 1", "**Priority:** zero"),
    ],
    [
      "empty dependencies",
      (value: string) =>
        value.replace("**Dependencies:** None", "**Dependencies:**   "),
    ],
    [
      "empty dependency",
      (value: string) =>
        value.replace("**Dependencies:** None", "**Dependencies:** US-000,"),
    ],
    [
      "unknown Story field",
      (value: string) => value.replace("**Description**", "**Unknown**"),
    ],
    [
      "duplicate Story field",
      (value: string) =>
        value.replace("**Acceptance criteria**", "**Description**"),
    ],
    [
      "missing Story field",
      (value: string) => value.replace("**References**", "References"),
    ],
    [
      "malformed list",
      (value: string) => value.replace("- [ ] First", "- First"),
    ],
    [
      "empty list item",
      (value: string) =>
        value.replace("- [ ] First behavior is visible", "- [ ] "),
    ],
    [
      "short coverage",
      (value: string) =>
        value.replace(
          /\| Source item[\s\S]*?\n\n## Stories/,
          "| Source item |\n\n## Stories",
        ),
    ],
    [
      "coverage header",
      (value: string) => value.replace("Story or boundary", "Target"),
    ],
    [
      "coverage separator",
      (value: string) =>
        value.replace("| --- | --- | --- |", "| - | --- | --- |"),
    ],
    [
      "coverage columns",
      (value: string) =>
        value.replace(
          "| `design.md § Outcome: first behavior` | Story | US-001 |",
          "| first | Story |",
        ),
    ],
    [
      "coverage disposition",
      (value: string) =>
        value.replace("| Story | US-001 |", "| Maybe | US-001 |"),
    ],
    [
      "coverage empty",
      (value: string) => value.replace("| Story | US-001 |", "| Story |  |"),
    ],
    [
      "unknown Story",
      (value: string) =>
        value.replace("| Story | US-001 |", "| Story | US-999 |"),
    ],
    [
      "non-goal target",
      (value: string) =>
        value.replace(
          "| Preserved non-goal | Project |",
          "| Preserved non-goal | US-001 |",
        ),
    ],
    [
      "invalid boundaries",
      (value: string) =>
        value.replace("## Plan boundaries\n\nNone", "## Plan boundaries"),
    ],
  ])("rejects malformed %s", async (_name, change) => {
    await expect(compilePrd(change(prd()))).rejects.toThrow(
      "invalid implementation PRD",
    );
  });

  it("rejects invalid coverage and boundary relationships", async () => {
    await expect(
      compilePrd(
        prd({ boundary: true }).replace(
          "| Plan boundary | PB-001 |",
          "| Plan boundary | PB-999 |",
        ),
      ),
    ).rejects.toThrow("unknown boundary");
    await expect(
      compilePrd(
        prd({ boundary: true }).replace(
          "| `design.md § Later: deferred behavior` | Plan boundary | PB-001 |\n",
          "",
        ),
      ),
    ).rejects.toThrow("PB-001: missing source coverage");
    await expect(
      compilePrd(
        prd().replace(
          "| `design.md § Outcome: first behavior` | Story | US-001 |\n",
          "",
        ),
      ),
    ).rejects.toThrow("US-001: missing source coverage");
    await expect(
      compilePrd(
        prd({ boundary: true }).replace("**Disposition:** deferred PRD", ""),
      ),
    ).rejects.toThrow("Disposition: missing field");
  });

  it("passes compiled Plans through the existing invariant validator", async () => {
    await expect(
      compilePrd(prd().replace("**Priority:** 1", "**Priority:** 2")),
    ).rejects.toThrow("expected 1 for Story order");
  });
});

describe("PrdCompiler", () => {
  it("validates repository evidence and installs the compiled Plan", async () => {
    const value = await repository(prd({ boundary: true, second: true }));
    const compiler = new PrdCompiler();
    expect(
      (await compiler.validate(value.root, value.path)).userStories,
    ).toHaveLength(2);
    const installed = await compiler.install(value.root, value.path);
    expect(installed).toBe(join(value.root, ".ralph", "plan.json"));
    expect(
      (JSON.parse(await readFile(installed, "utf8")) as { project: string })
        .project,
    ).toBe("Fixture");
  });

  it("rejects PRDs outside tracked, unchanged repository history", async () => {
    const value = await repository();
    const compiler = new PrdCompiler();
    const outside = join(value.root, "outside.md");
    await writeFile(outside, prd());
    await expect(compiler.validate(value.root, outside)).rejects.toThrow(
      "must be a file under",
    );

    const untracked = join(value.root, ".ralph", "prds", "untracked.md");
    await writeFile(untracked, prd());
    await expect(compiler.validate(value.root, untracked)).rejects.toThrow(
      "must be tracked",
    );

    await writeFile(value.path, `${prd()}\nchanged\n`);
    await expect(compiler.validate(value.root, value.path)).rejects.toThrow(
      "must be unchanged",
    );
  });

  it("rejects symlinks, nested repositories, and branch mismatches", async () => {
    const value = await repository();
    const compiler = new PrdCompiler();
    const link = join(value.root, ".ralph", "prds", "link.md");
    await symlink(value.path, link);
    await expect(compiler.validate(value.root, link)).rejects.toThrow(
      "symlinked PRD",
    );

    await expect(
      compiler.validate(join(value.root, ".ralph"), value.path),
    ).rejects.toThrow("not a Git repository root");

    execFileSync("git", ["-C", value.root, "switch", "-q", "-c", "other"]);
    await expect(compiler.validate(value.root, value.path)).rejects.toThrow(
      "does not match current branch",
    );
  });

  it("rejects missing and malformed Story references", async () => {
    const cases = [
      ["Source reference", "Source: `missing.md § Outcome`"],
      ["heading not found", "Source: `design.md § Missing`"],
      ["Repository reference", "Repository: `missing.md`"],
      ["expected Source", "Other: `README.md`"],
    ] as const;
    for (const [message, replacement] of cases) {
      const value = await repository(
        prd().replace("Source: `design.md § Outcome`", replacement),
      );
      await expect(
        new PrdCompiler().validate(value.root, value.path),
      ).rejects.toThrow(message);
    }

    const noSource = await repository(
      prd().replace("- Source: `design.md § Outcome`\n", ""),
    );
    await expect(
      new PrdCompiler().validate(noSource.root, noSource.path),
    ).rejects.toThrow("missing Source reference");

    const noRepository = await repository(
      prd().replace("- Repository: `README.md`", ""),
    );
    await expect(
      new PrdCompiler().validate(noRepository.root, noRepository.path),
    ).rejects.toThrow("missing Repository reference");
  });

  it("accepts Source headings containing inline code", async () => {
    const source = prd().replace(
      "- Source: `design.md § Outcome`",
      "- Source: `design.md § Outcome `code``",
    );
    const value = await repository(
      source,
      "# Design\n\n## Outcome `code`\n\n## Later\n",
    );

    await expect(
      new PrdCompiler().validate(value.root, value.path),
    ).resolves.toBeDefined();
  });

  it("rejects a missing primary source", async () => {
    const value = await repository(
      prd().replace("`design.md`", "`missing.md`"),
    );
    await expect(
      new PrdCompiler().validate(value.root, value.path),
    ).rejects.toThrow("Source: path does not exist");
  });

  it("accepts absolute references and Source references without headings", async () => {
    const value = await repository();
    const source = prd()
      .replace(
        "Source: `design.md § Outcome`",
        `Source: \`${join(value.root, "design.md")}\``,
      )
      .replace(
        "Repository: `README.md`",
        `Repository: \`${join(value.root, "README.md")}\``,
      );
    await writeFile(value.path, source);
    execFileSync("git", ["-C", value.root, "add", value.path]);
    execFileSync("git", ["-C", value.root, "commit", "-q", "-m", "references"]);
    await expect(
      new PrdCompiler().validate(value.root, value.path),
    ).resolves.toBeDefined();
  });
});
