import {
  mkdtemp,
  mkdir,
  readFile,
  symlink,
  watch,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { afterEach, describe, expect, it } from "vitest";
import { rm } from "node:fs/promises";
import { PlanStore, digest } from "../src/plan/store.js";
import {
  allStoriesPassed,
  parsePlan,
  selectReadyStory,
  validatePlan,
} from "../src/plan/validate.js";
import type { Plan } from "../src/plan/model.js";

const roots: string[] = [];
afterEach(async () =>
  Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  ),
);

function plan(): Plan {
  return {
    schemaVersion: 1,
    project: "Fixture",
    branchName: "ralph/test",
    description: "Two outcomes",
    userStories: [
      {
        id: "US-001",
        title: "First",
        description: "First outcome",
        acceptanceCriteria: ["Observable"],
        nonGoals: [],
        checks: ["true"],
        references: ["README.md"],
        dependencies: [],
        priority: 1,
        passes: false,
        notes: "",
      },
      {
        id: "US-002",
        title: "Second",
        description: "Second outcome",
        acceptanceCriteria: ["Observable"],
        nonGoals: [],
        checks: ["true"],
        references: ["README.md"],
        dependencies: ["US-001"],
        priority: 2,
        passes: false,
        notes: "",
      },
    ],
  };
}

describe("Plan validation", () => {
  it("accepts conversion and runtime Plans through their public modes", async () => {
    expect((await validatePlan(plan(), "conversion")).problems).toEqual([]);
    const runtime = plan();
    runtime.userStories[0]!.passes = true;
    runtime.userStories[0]!.notes = " done ";
    expect((await validatePlan(runtime, "runtime")).problems).toEqual([]);
    expect((await validatePlan(runtime, "conversion")).problems).toEqual([
      "userStories[0].passes: conversion requires false",
      "userStories[0].notes: conversion requires an empty string",
    ]);
  });

  it("reports schema and cross-Story problems with field paths", async () => {
    const invalid = plan() as unknown as Record<string, unknown>;
    invalid.extra = true;
    delete invalid.project;
    const result = await validatePlan(invalid, "conversion");
    expect(result.problems).toContain("project: missing required field");
    expect(result.problems).toContain("extra: unknown field");

    const relationships = plan();
    relationships.userStories[0]!.id = "US-002";
    relationships.userStories[0]!.priority = 2;
    relationships.userStories[1]!.dependencies = [
      "US-002",
      "missing",
      "missing",
    ];
    const relationshipResult = await validatePlan(relationships, "runtime");
    expect(relationshipResult.problems.join("\n")).toContain(
      'expected "US-001"',
    );
    expect(relationshipResult.problems.join("\n")).toContain(
      "duplicate of userStories[0].id",
    );
    expect(relationshipResult.problems.join("\n")).toContain(
      "duplicate of userStories[0].priority",
    );
    expect(relationshipResult.problems.join("\n")).toContain(
      "cannot depend on itself",
    );
    expect(relationshipResult.problems.join("\n")).toContain(
      "does not name an existing Story",
    );
    expect(relationshipResult.problems.join("\n")).toContain(
      "duplicate dependency",
    );

    const forward = plan();
    forward.userStories[0]!.dependencies = ["US-002"];
    expect(
      (await validatePlan(forward, "runtime")).problems.join("\n"),
    ).toContain("not earlier than");
    forward.userStories[1]!.passes = true;
    expect(
      (await validatePlan(forward, "runtime")).problems.join("\n"),
    ).toContain("must pass before");
  });

  it("reports nested schema constraints", async () => {
    const missingNested = plan() as unknown as {
      userStories: Array<Record<string, unknown>>;
    };
    delete missingNested.userStories[0]!.title;
    missingNested.userStories[0]!.extra = true;
    missingNested.userStories[0]!.checks = [];
    const problems = (await validatePlan(missingNested, "conversion")).problems;
    expect(problems).toContain("userStories[0].title: missing required field");
    expect(problems).toContain("userStories[0].extra: unknown field");
    expect(problems).toContain(
      "userStories[0].checks: must contain at least 1 item(s)",
    );
    expect((await validatePlan([], "conversion")).problems).toContain(
      "$: must be object",
    );
  });

  it("rejects malformed JSON and surrounding whitespace", async () => {
    await expect(parsePlan("{", "runtime")).rejects.toThrow("invalid JSON");
    const invalid = plan();
    invalid.project = " padded ";
    await expect(parsePlan(JSON.stringify(invalid), "runtime")).rejects.toThrow(
      "pattern",
    );
  });

  it("selects only ready Stories and recognizes completion", () => {
    const value = plan();
    expect(selectReadyStory(value)?.id).toBe("US-001");
    expect(allStoriesPassed(value)).toBe(false);
    value.userStories[0]!.passes = true;
    expect(selectReadyStory(value)?.id).toBe("US-002");
    value.userStories[1]!.passes = true;
    expect(selectReadyStory(value)).toBeUndefined();
    expect(allStoriesPassed(value)).toBe(true);
    const unordered = plan();
    unordered.userStories[0]!.priority = 2;
    unordered.userStories[1]!.priority = 1;
    unordered.userStories[1]!.dependencies = [];
    expect(selectReadyStory(unordered)?.id).toBe("US-002");
  });
});

describe("PlanStore", () => {
  it("completes a ready Story with an expected digest", async () => {
    const root = await mkdtemp(join(tmpdir(), "ralph-plan-"));
    roots.push(root);
    const path = join(root, "prd.json");
    const source = `${JSON.stringify(plan(), null, 2)}\n`;
    await writeFile(path, source);
    await new PlanStore().complete(path, "US-001", "done", digest(source));
    const result = JSON.parse(await readFile(path, "utf8")) as Plan;
    expect(result.userStories[0]).toMatchObject({
      passes: true,
      notes: "done",
    });
  });

  it("refuses unsafe or invalid Story completion", async () => {
    const root = await mkdtemp(join(tmpdir(), "ralph-complete-"));
    roots.push(root);
    const path = join(root, "prd.json");
    const source = `${JSON.stringify(plan(), null, 2)}\n`;
    await writeFile(path, source);
    const store = new PlanStore();
    await expect(
      store.complete(path, "US-001", "done", "stale"),
    ).rejects.toThrow("changed before");
    await expect(
      store.complete(path, "US-999", "done", digest(source)),
    ).rejects.toThrow("Story not found");
    await expect(
      store.complete(path, "US-002", "done", digest(source)),
    ).rejects.toThrow("incomplete dependencies");
    const passed = plan();
    passed.userStories[0]!.passes = true;
    passed.userStories[0]!.notes = "done";
    const passedSource = JSON.stringify(passed);
    await writeFile(path, passedSource);
    await expect(
      store.complete(path, "US-001", "done", digest(passedSource)),
    ).rejects.toThrow("already passed");
    const actual = join(root, "actual.json");
    await writeFile(actual, source);
    const linked = join(root, "linked.json");
    await symlink(actual, linked);
    await expect(
      store.complete(linked, "US-001", "done", digest(source)),
    ).rejects.toThrow("symlinked Plan");
    const blocker = join(root, "blocker");
    await writeFile(blocker, "file");
    await expect(
      store.complete(join(blocker, "child"), "US-001", "done", digest(source)),
    ).rejects.toThrow();
  });

  it("does not replace a Plan changed during its update", async () => {
    const root = await mkdtemp(join(tmpdir(), "ralph-race-"));
    roots.push(root);
    const path = join(root, "prd.json");
    const source = `${JSON.stringify(plan(), null, 2)}\n`;
    await writeFile(path, source);
    const events = watch(root);
    const mutation = (async () => {
      for await (const event of events) {
        if (event.filename?.startsWith(".prd.json.")) {
          await writeFile(path, `${source} `);
          break;
        }
      }
    })();
    const completion = new PlanStore().complete(
      path,
      "US-001",
      "done",
      digest(source),
    );
    const rejected = expect(completion).rejects.toThrow(
      "changed during engine update",
    );
    await mutation;
    await events.return?.();
    await rejected;
  });

  it("installs a valid Plan only in a configured repository", async () => {
    const root = await mkdtemp(join(tmpdir(), "ralph-install-"));
    roots.push(root);
    execFileSync("git", ["init", "-q", "-b", "main", root]);
    await mkdir(join(root, ".ralph"));
    await writeFile(
      join(root, ".ralph", ".gitignore"),
      "*\n!.gitignore\n!prds/\n!prds/**\n",
    );
    const candidate = join(root, "candidate.json");
    await writeFile(candidate, JSON.stringify(plan()));
    const destination = await new PlanStore().install(root, candidate);
    expect(JSON.parse(await readFile(destination, "utf8"))).toEqual(plan());
    await expect(new PlanStore().install(root, candidate)).rejects.toThrow(
      "already exists",
    );
  });

  it("refuses a symlinked Ralph directory", async () => {
    const root = await mkdtemp(join(tmpdir(), "ralph-symlink-"));
    const outside = await mkdtemp(join(tmpdir(), "ralph-outside-"));
    roots.push(root, outside);
    execFileSync("git", ["init", "-q", "-b", "main", root]);
    await symlink(outside, join(root, ".ralph"));
    const candidate = join(root, "candidate.json");
    await writeFile(candidate, JSON.stringify(plan()));
    await expect(new PlanStore().install(root, candidate)).rejects.toThrow(
      "symlinked .ralph",
    );
  });

  it("refuses non-root, unignored, and invalid installations", async () => {
    const root = await mkdtemp(join(tmpdir(), "ralph-install-errors-"));
    roots.push(root);
    execFileSync("git", ["init", "-q", "-b", "main", root]);
    const nested = join(root, "nested");
    await mkdir(nested);
    const candidate = join(root, "candidate.json");
    await writeFile(candidate, JSON.stringify(plan()));
    await expect(new PlanStore().install(nested, candidate)).rejects.toThrow(
      "not a Git repository root",
    );
    await expect(new PlanStore().install(root, candidate)).rejects.toThrow(
      "is not ignored",
    );
    await writeFile(candidate, "{}");
    await expect(new PlanStore().install(root, candidate)).rejects.toThrow(
      "invalid Ralph Plan",
    );
  });
});
