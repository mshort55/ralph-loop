import { execFileSync } from "node:child_process";
import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { runPlan } from "../src/run/run-plan.js";
import type { Plan } from "../src/plan/model.js";
import { ProcessRunner } from "../src/system/process.js";

const fakeCodex = fileURLToPath(
  new URL("fixtures/fake-codex.ts", import.meta.url),
);
const roots: string[] = [];
beforeAll(async () => chmod(fakeCodex, 0o755));
afterEach(async () =>
  Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  ),
);
afterAll(async () => chmod(fakeCodex, 0o755));

function story(
  id: string,
  title: string,
  priority: number,
  dependencies: string[],
  check: string,
) {
  return {
    id,
    title,
    description: `Implement ${title}`,
    acceptanceCriteria: [`The ${title} outcome is observable`],
    nonGoals: [],
    checks: [check],
    references: [".ralph/prds/prd-fixture.md § Stories"],
    dependencies,
    priority,
    passes: false,
    notes: "",
  };
}

function twoStoryPlan(): Plan {
  return {
    schemaVersion: 1,
    project: "Fixture",
    branchName: "ralph/test",
    description: "Complete two ordered outcomes",
    userStories: [
      story("US-001", "first outcome", 1, [], "grep -qx one story-1.txt"),
      story(
        "US-002",
        "second outcome",
        2,
        ["US-001"],
        "grep -qx two story-2.txt",
      ),
    ],
  };
}

async function fixture(): Promise<{
  repo: string;
  planPath: string;
  state: string;
  bin: string;
}> {
  const repo = await mkdtemp(join(tmpdir(), "ralph-run-"));
  const bin = await mkdtemp(join(tmpdir(), "ralph-bin-"));
  roots.push(repo, bin);
  execFileSync("git", ["init", "-q", "-b", "ralph/test", repo]);
  execFileSync("git", ["-C", repo, "config", "user.name", "Ralph Fixture"]);
  execFileSync("git", [
    "-C",
    repo,
    "config",
    "user.email",
    "ralph-fixture@example.com",
  ]);
  execFileSync("git", ["-C", repo, "config", "commit.gpgsign", "false"]);
  await mkdir(join(repo, ".ralph", "prds"), { recursive: true });
  await writeFile(
    join(repo, ".ralph", ".gitignore"),
    "*\n!.gitignore\n!prds/\n!prds/**\n",
  );
  await writeFile(
    join(repo, ".ralph", "prds", "prd-fixture.md"),
    "# Fixture PRD\n",
  );
  await writeFile(join(repo, "README"), "base\n");
  execFileSync("git", ["-C", repo, "add", "."]);
  execFileSync("git", ["-C", repo, "commit", "-q", "-m", "init"]);
  const planPath = join(repo, ".ralph", "prd.json");
  await writeFile(planPath, `${JSON.stringify(twoStoryPlan(), null, 2)}\n`);
  await mkdir(bin, { recursive: true });
  await (
    await import("node:fs/promises")
  ).symlink(fakeCodex, join(bin, "codex"));
  return { repo, planPath, state: join(repo, ".ralph", "fake"), bin };
}

function environment(
  value: { state: string; bin: string },
  scenario: string,
): NodeJS.ProcessEnv {
  return {
    ...process.env,
    PATH: `${value.bin}:${process.env.PATH ?? ""}`,
    RALPH_FAKE_STATE: value.state,
    RALPH_FAKE_SCENARIO: scenario,
  };
}

describe("runPlan", () => {
  it("completes ordered Stories with fresh agents and engine-owned commits", async () => {
    const value = await fixture();
    const output: string[] = [];
    await runPlan(
      { repo: value.repo, plan: value.planPath, iterations: 3 },
      {
        env: environment(value, "multi"),
        writeLine: (line) => output.push(line),
      },
    );
    const completed = JSON.parse(
      await readFile(value.planPath, "utf8"),
    ) as Plan;
    expect(completed.userStories.map((item) => item.passes)).toEqual([
      true,
      true,
    ]);
    expect(
      execFileSync("git", ["-C", value.repo, "log", "--format=%s", "-2"], {
        encoding: "utf8",
      }),
    ).toBe("ralph(US-002): second outcome\nralph(US-001): first outcome\n");
    expect(await readFile(join(value.state, "count"), "utf8")).toBe("2\n");
    expect(output).toContain("All Stories machine-complete");
    const args = JSON.parse(
      await readFile(join(value.state, "argv.1.json"), "utf8"),
    ) as string[];
    expect(args).toContain("--approve-for-me");
    expect(args).not.toContain("--sandbox");
    expect(await readFile(join(value.state, "caps.1"), "utf8")).toMatch(
      /CapInh:\s+0+\nCapAmb:\s+0+/,
    );
  });

  it("retains work and logs while retrying a failed Check", async () => {
    const value = await fixture();
    await runPlan(
      { repo: value.repo, plan: value.planPath, iterations: 3 },
      {
        env: environment(value, "retry"),
        writeLine: () => undefined,
      },
    );
    expect(await readFile(join(value.state, "count"), "utf8")).toBe("3\n");
    expect(await readFile(join(value.state, "prompt.2"), "utf8")).toContain(
      "iteration-001-US-001-checks.log",
    );
  });

  it("marks an already-satisfied Story without an empty commit", async () => {
    const value = await fixture();
    const current = twoStoryPlan();
    current.userStories = [story("US-001", "first outcome", 1, [], "true")];
    await writeFile(value.planPath, JSON.stringify(current));
    const before = execFileSync(
      "git",
      ["-C", value.repo, "rev-parse", "HEAD"],
      { encoding: "utf8" },
    );
    const output: string[] = [];
    await runPlan(
      { repo: value.repo, plan: value.planPath, iterations: 1 },
      {
        env: environment(value, "none"),
        writeLine: (line) => output.push(line),
      },
    );
    expect(
      execFileSync("git", ["-C", value.repo, "rev-parse", "HEAD"], {
        encoding: "utf8",
      }),
    ).toBe(before);
    expect(output.some((line) => line.includes("without changes"))).toBe(true);
  });

  it.each([
    ["mutate-plan", "Plan changed"],
    ["switch-branch", "branch changed"],
    ["commit", "HEAD changed"],
    ["stage", "index is not empty"],
    ["remove-ignore", "Plan is no longer ignored"],
  ])("stops on the %s agent invariant violation", async (scenario, message) => {
    const value = await fixture();
    await expect(
      runPlan(
        { repo: value.repo, plan: value.planPath, iterations: 2 },
        {
          env: environment(value, scenario),
          writeLine: () => undefined,
        },
      ),
    ).rejects.toThrow(message);
    expect(await readFile(join(value.state, "count"), "utf8")).toBe("1\n");
  });

  it("reconciles an engine commit left ahead of Plan state", async () => {
    const value = await fixture();
    await writeFile(join(value.repo, "story-1.txt"), "one\n");
    execFileSync("git", ["-C", value.repo, "add", "story-1.txt"]);
    execFileSync("git", [
      "-C",
      value.repo,
      "commit",
      "-q",
      "-m",
      "ralph(US-001): first outcome",
      "-m",
      "Ralph-Story: US-001",
    ]);
    await runPlan(
      { repo: value.repo, plan: value.planPath, iterations: 1 },
      {
        env: environment(value, "two"),
        writeLine: () => undefined,
      },
    );
    expect(
      (
        JSON.parse(await readFile(value.planPath, "utf8")) as Plan
      ).userStories.every((item) => item.passes),
    ).toBe(true);
  });

  it("continues a partially completed Plan in a later Run", async () => {
    const value = await fixture();
    await expect(
      runPlan(
        { repo: value.repo, plan: value.planPath, iterations: 1 },
        {
          env: environment(value, "one"),
          writeLine: () => undefined,
        },
      ),
    ).rejects.toThrow("budget exhausted");
    expect(
      (
        JSON.parse(await readFile(value.planPath, "utf8")) as Plan
      ).userStories.map((item) => item.passes),
    ).toEqual([true, false]);
    const secondState = join(value.repo, ".ralph", "fake-second");
    await runPlan(
      { repo: value.repo, plan: value.planPath, iterations: 1 },
      {
        env: environment({ ...value, state: secondState }, "two"),
        writeLine: () => undefined,
      },
    );
    expect(
      (
        JSON.parse(await readFile(value.planPath, "utf8")) as Plan
      ).userStories.every((item) => item.passes),
    ).toBe(true);
  });

  it("returns immediately for an all-passed Plan without requiring Codex", async () => {
    const value = await fixture();
    const complete = twoStoryPlan();
    for (const item of complete.userStories) {
      item.passes = true;
      item.notes = "done";
    }
    await writeFile(value.planPath, JSON.stringify(complete));
    const env = environment(value, "none");
    env.RALPH_FAKE_LOGIN_FAIL = "1";
    const output: string[] = [];
    await runPlan(
      { repo: value.repo, plan: value.planPath, iterations: 1 },
      { env, writeLine: (line) => output.push(line) },
    );
    expect(output).toEqual(["All Stories machine-complete"]);
    await expect(
      readFile(join(value.state, "count"), "utf8"),
    ).rejects.toThrow();
  });

  it("rejects invalid starts before invoking an agent", async () => {
    const value = await fixture();
    await expect(
      runPlan({ repo: value.repo, plan: value.planPath, iterations: 0 }),
    ).rejects.toThrow("invalid --iterations");
    const empty = await mkdtemp(join(tmpdir(), "ralph-empty-"));
    roots.push(empty);
    await expect(
      runPlan({
        repo: empty,
        plan: join(empty, ".ralph", "prd.json"),
        iterations: 1,
      }),
    ).rejects.toThrow();
    const wrongPath = join(value.repo, "wrong.json");
    await writeFile(wrongPath, JSON.stringify(twoStoryPlan()));
    await expect(
      runPlan({ repo: value.repo, plan: wrongPath, iterations: 1 }),
    ).rejects.toThrow("Plan must be");
    const mismatched = twoStoryPlan();
    mismatched.branchName = "other";
    await writeFile(value.planPath, JSON.stringify(mismatched));
    await expect(
      runPlan(
        { repo: value.repo, plan: value.planPath, iterations: 1 },
        {
          env: environment(value, "none"),
          writeLine: () => undefined,
        },
      ),
    ).rejects.toThrow("does not match Plan branch");
    mismatched.branchName = "ralph/test";
    await writeFile(value.planPath, JSON.stringify(mismatched));
    await writeFile(join(value.repo, "dirty"), "dirty");
    await expect(
      runPlan(
        { repo: value.repo, plan: value.planPath, iterations: 1 },
        {
          env: environment(value, "none"),
          writeLine: () => undefined,
        },
      ),
    ).rejects.toThrow("must be clean");
  });

  it("rejects symlinked Ralph storage and an unignored Plan", async () => {
    const linked = await fixture();
    const actual = join(linked.repo, "actual-ralph");
    await (
      await import("node:fs/promises")
    ).rename(join(linked.repo, ".ralph"), actual);
    await (
      await import("node:fs/promises")
    ).symlink(actual, join(linked.repo, ".ralph"));
    await expect(
      runPlan({
        repo: linked.repo,
        plan: join(linked.repo, ".ralph", "prd.json"),
        iterations: 1,
      }),
    ).rejects.toThrow("symlinked .ralph");

    const unignored = await fixture();
    await writeFile(join(unignored.repo, ".ralph", ".gitignore"), "");
    execFileSync("git", [
      "-C",
      unignored.repo,
      "add",
      "-f",
      ".ralph/.gitignore",
    ]);
    execFileSync("git", [
      "-C",
      unignored.repo,
      "commit",
      "-q",
      "-m",
      "remove ignore",
    ]);
    await expect(
      runPlan(
        { repo: unignored.repo, plan: unignored.planPath, iterations: 1 },
        {
          env: environment(unignored, "none"),
          writeLine: () => undefined,
        },
      ),
    ).rejects.toThrow("is not ignored");
  });

  it("reports missing commands and failed Codex authentication", async () => {
    const value = await fixture();
    class MissingCommand extends ProcessRunner {
      override async available(command: string, env?: NodeJS.ProcessEnv) {
        if (command === "bash") return false;
        return super.available(command, env);
      }
    }
    await expect(
      runPlan(
        { repo: value.repo, plan: value.planPath, iterations: 1 },
        {
          env: environment(value, "none"),
          processes: new MissingCommand(),
          writeLine: () => undefined,
        },
      ),
    ).rejects.toThrow("required executable not found: bash");
    class MissingSetpriv extends ProcessRunner {
      override async available(command: string, env?: NodeJS.ProcessEnv) {
        if (command === "setpriv") return false;
        return super.available(command, env);
      }
    }
    await expect(
      runPlan(
        { repo: value.repo, plan: value.planPath, iterations: 1 },
        {
          env: environment(value, "none"),
          processes: new MissingSetpriv(),
          writeLine: () => undefined,
        },
      ),
    ).rejects.toThrow("required executable not found: setpriv");
    const env = environment(value, "none");
    env.RALPH_FAKE_LOGIN_FAIL = "1";
    await expect(
      runPlan(
        { repo: value.repo, plan: value.planPath, iterations: 1 },
        {
          env,
          writeLine: () => undefined,
        },
      ),
    ).rejects.toThrow("Codex is not logged in");
  });

  it("consumes the budget for agent failures and Check timeouts", async () => {
    const failed = await fixture();
    await expect(
      runPlan(
        { repo: failed.repo, plan: failed.planPath, iterations: 1 },
        {
          env: environment(failed, "fail"),
          writeLine: () => undefined,
        },
      ),
    ).rejects.toThrow("budget exhausted");
    const timed = await fixture();
    const slow = twoStoryPlan();
    slow.userStories = [story("US-001", "slow", 1, [], "sleep 10")];
    await writeFile(timed.planPath, JSON.stringify(slow));
    await expect(
      runPlan(
        { repo: timed.repo, plan: timed.planPath, iterations: 1 },
        {
          env: environment(timed, "none"),
          writeLine: () => undefined,
          checkTimeoutMs: 20,
        },
      ),
    ).rejects.toThrow("budget exhausted");
  });

  it("rejects unreconcilable engine commits", async () => {
    const notReady = await fixture();
    execFileSync("git", [
      "-C",
      notReady.repo,
      "commit",
      "--allow-empty",
      "-q",
      "-m",
      "ralph(US-002): second outcome",
      "-m",
      "Ralph-Story: US-002",
    ]);
    await expect(
      runPlan(
        { repo: notReady.repo, plan: notReady.planPath, iterations: 1 },
        {
          env: environment(notReady, "none"),
          writeLine: () => undefined,
        },
      ),
    ).rejects.toThrow("not the next ready Story");

    const wrongSubject = await fixture();
    execFileSync("git", [
      "-C",
      wrongSubject.repo,
      "commit",
      "--allow-empty",
      "-q",
      "-m",
      "wrong",
      "-m",
      "Ralph-Story: US-001",
    ]);
    await expect(
      runPlan(
        { repo: wrongSubject.repo, plan: wrongSubject.planPath, iterations: 1 },
        {
          env: environment(wrongSubject, "none"),
          writeLine: () => undefined,
        },
      ),
    ).rejects.toThrow("subject does not match Story");
  });
});
