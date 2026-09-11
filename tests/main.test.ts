import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { main } from "../src/main.js";
import type { Plan } from "../src/plan/model.js";

const roots: string[] = [];
afterEach(async () =>
  Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  ),
);

const validPlan: Plan = {
  schemaVersion: 1,
  project: "Fixture",
  branchName: "main",
  description: "Outcome",
  userStories: [
    {
      id: "US-001",
      title: "First",
      description: "First",
      acceptanceCriteria: ["Visible"],
      nonGoals: [],
      checks: ["true"],
      references: ["README"],
      dependencies: [],
      priority: 1,
      passes: false,
      notes: "",
    },
  ],
};

function io() {
  const stdout: string[] = [];
  const stderr: string[] = [];
  return {
    stdout,
    stderr,
    value: {
      stdout: (line: string) => stdout.push(line),
      stderr: (line: string) => stderr.push(line),
    },
  };
}

describe("ralph CLI", () => {
  it("wires process arguments to the executable entrypoint", async () => {
    const previousArguments = process.argv;
    const previousExitCode = process.exitCode;
    const error = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    process.argv = ["node", "ralph"];
    await import("../src/cli.js");
    expect(process.exitCode).toBe(1);
    expect(error).toHaveBeenCalledWith(expect.stringContaining("Usage:"));
    process.argv = previousArguments;
    process.exitCode = previousExitCode;
    error.mockRestore();
  });

  it("validates Plans in conversion and runtime modes", async () => {
    const root = await mkdtemp(join(tmpdir(), "ralph-cli-"));
    roots.push(root);
    const path = join(root, "plan.json");
    await writeFile(path, JSON.stringify(validPlan));
    const output = io();
    expect(await main(["plan", "validate", path], output.value)).toBe(0);
    expect(
      await main(["plan", "validate", "--mode", "runtime", path], output.value),
    ).toBe(0);
    await writeFile(path, "{");
    expect(await main(["plan", "validate", path], output.value)).toBe(1);
    expect(output.stderr.at(-1)).toContain("invalid JSON");
  });

  it("installs a Plan", async () => {
    const root = await mkdtemp(join(tmpdir(), "ralph-cli-install-"));
    roots.push(root);
    execFileSync("git", ["init", "-q", "-b", "main", root]);
    await mkdir(join(root, ".ralph"));
    await writeFile(join(root, ".ralph", ".gitignore"), "*\n!.gitignore\n");
    const candidate = join(root, "candidate.json");
    await writeFile(candidate, JSON.stringify(validPlan));
    const output = io();
    expect(
      await main(
        ["plan", "install", "--repo", root, "--from", candidate],
        output.value,
      ),
    ).toBe(0);
    expect(
      JSON.parse(await readFile(join(root, ".ralph", "plan.json"), "utf8")),
    ).toEqual(validPlan);
  });

  it("validates and installs a tracked implementation PRD", async () => {
    const root = await mkdtemp(join(tmpdir(), "ralph-cli-prd-"));
    roots.push(root);
    execFileSync("git", ["init", "-q", "-b", "main", root]);
    await mkdir(join(root, ".ralph", "prds"), { recursive: true });
    await writeFile(
      join(root, ".ralph", ".gitignore"),
      "*\n!.gitignore\n!prds/\n!prds/**\n",
    );
    await writeFile(join(root, "design.md"), "# Design\n\n## Outcome\n");
    await writeFile(join(root, "README.md"), "fixture\n");
    const path = join(root, ".ralph", "prds", "fixture.md");
    await writeFile(
      path,
      `# PRD: Fixture

## Project
Fixture

## Branch
main

## Source
\`design.md\`

## Description
Outcome

## Source coverage

| Source item | Disposition | Story or boundary |
| --- | --- | --- |
| design.md § Outcome: behavior | Story | US-001 |

## Stories

### US-001: First

**Priority:** 1
**Dependencies:** None

**Description**
First

**Acceptance criteria**

- [ ] Visible

**Non-goals**

None

**Checks**

- \`true\`

**References**

- Source: \`design.md § Outcome\`
- Repository: \`README.md\`

## Plan boundaries

None
`,
    );
    execFileSync("git", ["-C", root, "add", "."]);
    execFileSync("git", [
      "-C",
      root,
      "-c",
      "user.name=Fixture",
      "-c",
      "user.email=fixture@test",
      "commit",
      "-q",
      "-m",
      "PRD",
    ]);
    const output = io();
    expect(
      await main(
        ["prd", "validate", "--repo", root, "--from", path],
        output.value,
      ),
    ).toBe(0);
    expect(
      await main(
        ["prd", "install", "--repo", root, "--from", path],
        output.value,
      ),
    ).toBe(0);
    const installed = JSON.parse(
      await readFile(join(root, ".ralph", "plan.json"), "utf8"),
    ) as Plan;
    expect(installed.project).toBe("Fixture");
    expect(installed.userStories[0]).toMatchObject({
      id: "US-001",
      title: "First",
      passes: false,
      notes: "",
    });
    expect(await main(["prd", "unknown"], output.value)).toBe(1);
    expect(output.stderr.at(-1)).toContain("unknown PRD operation");
    expect(await main(["prd"], output.value)).toBe(1);
  });

  it("runs an already-complete Plan", async () => {
    const root = await mkdtemp(join(tmpdir(), "ralph-cli-run-"));
    roots.push(root);
    execFileSync("git", ["init", "-q", "-b", "main", root]);
    execFileSync("git", ["-C", root, "config", "user.name", "Ralph Fixture"]);
    execFileSync("git", [
      "-C",
      root,
      "config",
      "user.email",
      "fixture@example.com",
    ]);
    await mkdir(join(root, ".ralph"));
    await writeFile(join(root, ".ralph", ".gitignore"), "*\n!.gitignore\n");
    await writeFile(join(root, "README"), "base\n");
    execFileSync("git", ["-C", root, "add", "."]);
    execFileSync("git", ["-C", root, "commit", "-q", "-m", "init"]);
    const complete = structuredClone(validPlan);
    complete.userStories[0]!.passes = true;
    complete.userStories[0]!.notes = "done";
    const planPath = join(root, ".ralph", "plan.json");
    await writeFile(planPath, JSON.stringify(complete));
    const output = io();
    expect(
      await main(
        ["run", "--repo", root, "--plan", planPath, "--iterations", "1"],
        output.value,
      ),
    ).toBe(0);
    expect(output.stdout).toContain("All Stories machine-complete");
  });

  it.each([
    [[], "Usage:"],
    [["unknown"], "unknown operation"],
    [["plan"], "Usage:"],
    [["plan", "unknown"], "unknown Plan operation"],
    [["plan", "validate", "--mode", "wrong", "x"], "invalid --mode"],
    [["plan", "validate", "--mode"], "invalid --mode"],
    [["plan", "validate"], "missing Plan path"],
    [["plan", "validate", "one", "two"], "unexpected argument"],
    [["plan", "install", "--repo", "x"], "missing --from"],
    [
      ["run", "--repo", "x", "--plan", "y", "--iterations", "0"],
      "invalid --iterations",
    ],
    [
      ["run", "--repo", "x", "--repo", "y", "--plan", "z", "--iterations", "1"],
      "duplicate --repo",
    ],
    [["run", "--wat"], "unknown argument"],
  ])("rejects invalid arguments %#", async (args, message) => {
    const output = io();
    expect(await main(args as string[], output.value)).toBe(1);
    expect(output.stderr.join("\n")).toContain(message as string);
  });

  it("rejects missing flag values and malformed argument arrays", async () => {
    const output = io();
    expect(await main(["run", "--repo"], output.value)).toBe(1);
    expect(output.stderr.at(-1)).toContain("missing value for --repo");
    expect(
      await main(
        ["plan", "install", undefined as unknown as string],
        output.value,
      ),
    ).toBe(1);
    expect(output.stderr.at(-1)).toContain("unknown argument");
  });
});
