import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ProcessRunner } from "../src/system/process.js";
import { TargetRepository } from "../src/system/git.js";
import { acquireRunLock } from "../src/system/lock.js";

const roots: string[] = [];
afterEach(async () =>
  Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  ),
);

async function repository(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "ralph-git-"));
  roots.push(root);
  execFileSync("git", ["init", "-q", "-b", "ralph/test", root]);
  execFileSync("git", ["-C", root, "config", "user.name", "Ralph Fixture"]);
  execFileSync("git", [
    "-C",
    root,
    "config",
    "user.email",
    "ralph-fixture@example.com",
  ]);
  await writeFile(
    join(root, ".gitignore"),
    ".ralph/plan.json\n.ralph/run.lock\n.ralph/runs/\n",
  );
  await writeFile(join(root, "README"), "base\n");
  execFileSync("git", ["-C", root, "add", ".gitignore", "README"]);
  execFileSync("git", ["-C", root, "commit", "-q", "-m", "init"]);
  return root;
}

describe("ProcessRunner", () => {
  it("passes arguments without evaluating shell syntax", async () => {
    const result = await new ProcessRunner().capture("printf", [
      "%s",
      "$(touch injected);safe",
    ]);
    expect(result).toMatchObject({
      exitCode: 0,
      stdout: "$(touch injected);safe",
      stderr: "",
    });
  });

  it("streams combined output to a file and accepts stdin", async () => {
    const root = await mkdtemp(join(tmpdir(), "ralph-process-"));
    roots.push(root);
    const log = join(root, "process.log");
    const result = await new ProcessRunner().toFile(
      "bash",
      ["-lc", "read value; echo out:$value; echo err >&2"],
      {
        input: "hello\n",
        logPath: log,
        cwd: root,
        timeoutMs: 1_000,
      },
    );
    expect(result.exitCode).toBe(0);
    expect(await readFile(log, "utf8")).toContain("out:hello");
    expect(await readFile(log, "utf8")).toContain("err");
  });

  it("terminates a command when its deadline expires", async () => {
    const result = await new ProcessRunner().capture("sleep", ["10"], {
      timeoutMs: 20,
    });
    expect(result.exitCode).not.toBe(0);
    expect(result.signal).toBe("SIGTERM");
  });
});

describe("TargetRepository", () => {
  it("captures state, detects mutation, and creates the engine commit", async () => {
    const root = await repository();
    const target = await TargetRepository.open(root, new ProcessRunner());
    expect(await target.branch()).toBe("ralph/test");
    expect(await target.planIgnored()).toBe(true);
    expect(await target.dirty()).toBe(false);
    const snapshot = await target.snapshot("digest");
    await writeFile(join(root, "story.txt"), "done\n");
    expect(await target.dirty()).toBe(true);
    await target.assertUnchanged(snapshot, "digest");
    const commit = await target.commitStory("US-001", "First outcome");
    expect(commit).toMatch(/^[0-9a-f]{40}$/);
    expect(await target.dirty()).toBe(false);
    expect(await target.lastCommit()).toMatchObject({
      subject: "ralph(US-001): First outcome",
      storyId: "US-001",
    });
  });

  it("reports branch, HEAD, index, Plan, and ignore invariant violations", async () => {
    const root = await repository();
    const target = await TargetRepository.open(root, new ProcessRunner());
    const head = await target.head();
    await expect(
      target.assertUnchanged(
        { branch: "other", head, planDigest: "same" },
        "same",
      ),
    ).rejects.toThrow("branch changed");
    await expect(
      target.assertUnchanged(
        { branch: "ralph/test", head: "other", planDigest: "same" },
        "same",
      ),
    ).rejects.toThrow("HEAD changed");
    await writeFile(join(root, "staged"), "value");
    execFileSync("git", ["-C", root, "add", "staged"]);
    await expect(
      target.assertUnchanged(
        { branch: "ralph/test", head, planDigest: "same" },
        "same",
      ),
    ).rejects.toThrow("index is not empty");
  });

  it("rejects nested repositories, detached HEAD, Git failures, and unsafe commits", async () => {
    const root = await repository();
    const nested = join(root, "nested");
    await (await import("node:fs/promises")).mkdir(nested);
    await expect(
      TargetRepository.open(nested, new ProcessRunner()),
    ).rejects.toThrow("worktree root");
    const target = await TargetRepository.open(root, new ProcessRunner());
    execFileSync("git", ["-C", root, "checkout", "--detach", "-q"]);
    await expect(target.branch()).rejects.toThrow("detached HEAD");
    execFileSync("git", ["-C", root, "switch", "-q", "ralph/test"]);
    await writeFile(join(root, ".gitignore"), "");
    execFileSync("git", ["-C", root, "add", ".gitignore"]);
    execFileSync("git", ["-C", root, "commit", "-q", "-m", "remove ignore"]);
    await expect(target.commitStory("US-001", "unsafe")).rejects.toThrow(
      "Plan is no longer ignored",
    );
    await rm(join(root, ".git"), { recursive: true });
    await expect(target.head()).rejects.toThrow();
    class EmptyGitFailure extends ProcessRunner {
      override async capture() {
        return { exitCode: 1, stdout: "", stderr: "", signal: null };
      }
    }
    await expect(
      TargetRepository.open(root, new EmptyGitFailure()),
    ).rejects.toThrow("git rev-parse failed");
  });
});

describe("Run lock", () => {
  it("excludes a concurrent holder and can be reacquired after release", async () => {
    const root = await mkdtemp(join(tmpdir(), "ralph-lock-"));
    roots.push(root);
    const path = join(root, "run");
    const release = await acquireRunLock(path);
    await expect(acquireRunLock(path)).rejects.toThrow("another Run");
    await release();
    const releaseAgain = await acquireRunLock(path);
    await releaseAgain();
  });
});
