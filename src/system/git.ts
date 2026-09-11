import { realpath } from "node:fs/promises";
import { resolve } from "node:path";
import type { ProcessRunner } from "./process.js";

export interface RepositorySnapshot {
  branch: string;
  head: string;
  planDigest: string;
}

export interface LastCommit {
  subject: string;
  storyId: string;
  hash: string;
}

export class TargetRepository {
  private constructor(
    readonly path: string,
    private readonly processes: ProcessRunner,
  ) {}

  static async open(
    path: string,
    processes: ProcessRunner,
  ): Promise<TargetRepository> {
    const canonical = await realpath(resolve(path));
    const target = new TargetRepository(canonical, processes);
    const topLevel = await target.git(["rev-parse", "--show-toplevel"]);
    if ((await realpath(topLevel)) !== canonical) {
      throw new Error(
        `repository path must be the worktree root: ${canonical}`,
      );
    }
    return target;
  }

  private async git(args: string[]): Promise<string>;
  private async git(
    args: string[],
    allowFailure: true,
  ): Promise<Awaited<ReturnType<ProcessRunner["capture"]>>>;
  private async git(args: string[], allowFailure = false) {
    const result = await this.processes.capture("git", [
      "-C",
      this.path,
      ...args,
    ]);
    if (!allowFailure && result.exitCode !== 0) {
      throw new Error(result.stderr.trim() || `git ${args[0]} failed`);
    }
    return allowFailure ? result : result.stdout.trim();
  }

  async branch(): Promise<string> {
    const result = await this.git(["symbolic-ref", "--short", "HEAD"], true);
    if (result.exitCode !== 0) throw new Error("detached HEAD is not allowed");
    return result.stdout.trim();
  }

  async head(): Promise<string> {
    return this.git(["rev-parse", "HEAD"]);
  }

  async dirty(): Promise<boolean> {
    return (
      (await this.git(["status", "--porcelain", "--untracked-files=all"])) !==
      ""
    );
  }

  async indexDirty(): Promise<boolean> {
    const result = await this.git(["diff", "--cached", "--quiet"], true);
    return result.exitCode !== 0;
  }

  async planIgnored(): Promise<boolean> {
    const result = await this.git(
      ["check-ignore", "-q", "--", ".ralph/plan.json"],
      true,
    );
    return result.exitCode === 0;
  }

  async verifyIdentity(): Promise<void> {
    await this.git(["var", "GIT_AUTHOR_IDENT"]);
    await this.git(["var", "GIT_COMMITTER_IDENT"]);
  }

  async snapshot(planDigest: string): Promise<RepositorySnapshot> {
    return { branch: await this.branch(), head: await this.head(), planDigest };
  }

  async assertUnchanged(
    expected: RepositorySnapshot,
    currentPlanDigest: string,
  ): Promise<void> {
    if (!(await this.planIgnored()))
      throw new Error("invariant violation: Plan is no longer ignored");
    const branch = await this.branch();
    if (branch !== expected.branch) {
      throw new Error(
        `invariant violation: branch changed (${expected.branch} -> ${branch})`,
      );
    }
    const head = await this.head();
    if (head !== expected.head) {
      throw new Error(
        `invariant violation: HEAD changed (${expected.head} -> ${head})`,
      );
    }
    if (await this.indexDirty())
      throw new Error("invariant violation: index is not empty");
    if (currentPlanDigest !== expected.planDigest)
      throw new Error("invariant violation: Plan changed");
  }

  async commitStory(storyId: string, title: string): Promise<string> {
    if (!(await this.planIgnored()))
      throw new Error("invariant violation: Plan is no longer ignored");
    await this.git(["add", "-A"]);
    await this.git([
      "commit",
      "-m",
      `ralph(${storyId}): ${title}`,
      "-m",
      `Ralph-Story: ${storyId}`,
    ]);
    return this.head();
  }

  async lastCommit(): Promise<LastCommit> {
    const separator = "\u001f";
    const output = await this.git([
      "log",
      "-1",
      `--format=%H${separator}%s${separator}%(trailers:key=Ralph-Story,valueonly)`,
    ]);
    const [hash = "", subject = "", storyId = ""] = output.split(separator);
    return { hash, subject, storyId: storyId.replaceAll(/[\r\n]/g, "") };
  }
}
