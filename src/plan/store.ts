import { createHash } from "node:crypto";
import { constants } from "node:fs";
import {
  access,
  lstat,
  mkdir,
  readFile,
  realpath,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import type { Plan, ValidationMode } from "./model.js";
import { parsePlan } from "./validate.js";

export function digest(source: string | Buffer): string {
  return createHash("sha256").update(source).digest("hex");
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

async function isSymbolicLink(path: string): Promise<boolean> {
  try {
    return (await lstat(path)).isSymbolicLink();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}

export class PlanStore {
  async read(
    path: string,
    mode: ValidationMode,
  ): Promise<{ plan: Plan; source: string; digest: string }> {
    const source = await readFile(path, "utf8");
    return {
      plan: await parsePlan(source, mode),
      source,
      digest: digest(source),
    };
  }

  async complete(
    path: string,
    storyId: string,
    notes: string,
    expectedDigest: string,
  ): Promise<void> {
    if (await isSymbolicLink(path))
      throw new Error(`${path}: symlinked Plan is not allowed`);
    const current = await this.read(path, "runtime");
    if (current.digest !== expectedDigest)
      throw new Error(`${path}: Plan changed before engine update`);
    const story = current.plan.userStories.find(
      (candidate) => candidate.id === storyId,
    );
    if (!story) throw new Error(`${storyId}: Story not found`);
    if (story.passes) throw new Error(`${storyId}: Story already passed`);
    const byId = new Map(
      current.plan.userStories.map((candidate) => [candidate.id, candidate]),
    );
    const incomplete = story.dependencies.filter(
      (dependency) => !byId.get(dependency)?.passes,
    );
    if (incomplete.length > 0)
      throw new Error(
        `${storyId}: incomplete dependencies: ${incomplete.join(", ")}`,
      );
    story.passes = true;
    story.notes = notes;
    const candidate = `${JSON.stringify(current.plan, null, 2)}\n`;
    const temporary = join(
      dirname(path),
      `.${path.split("/").at(-1)}.${process.pid}.tmp`,
    );
    try {
      await writeFile(temporary, candidate, { flag: "wx" });
      if (digest(await readFile(path)) !== expectedDigest) {
        throw new Error(`${path}: Plan changed during engine update`);
      }
      await rename(temporary, path);
    } finally {
      await rm(temporary, { force: true });
    }
  }

  async install(repoArgument: string, sourceArgument: string): Promise<string> {
    const repo = await realpath(resolve(repoArgument));
    const sourcePath = await realpath(resolve(sourceArgument));
    const topLevelResult = spawnSync(
      "git",
      ["-C", repo, "rev-parse", "--show-toplevel"],
      { encoding: "utf8" },
    );
    if (
      topLevelResult.status !== 0 ||
      (await realpath(topLevelResult.stdout.trim())) !== repo
    ) {
      throw new Error(`${repo}: not a Git repository root`);
    }
    const ralphDirectory = join(repo, ".ralph");
    const destination = join(ralphDirectory, "plan.json");
    if (await isSymbolicLink(ralphDirectory)) {
      throw new Error(
        `${ralphDirectory}: symlinked .ralph directory is not allowed`,
      );
    }
    if ((await exists(destination)) || (await isSymbolicLink(destination))) {
      throw new Error(
        `${destination}: Plan already exists; refuse to replace execution state`,
      );
    }
    const candidate = await readFile(sourcePath, "utf8");
    await parsePlan(candidate, "conversion");
    const ignored = spawnSync("git", [
      "-C",
      repo,
      "check-ignore",
      "-q",
      "--",
      ".ralph/plan.json",
    ]);
    if (ignored.status !== 0) {
      throw new Error(
        `${repo}: .ralph/plan.json is not ignored; configure Ralph runtime-state ignores before conversion`,
      );
    }
    await mkdir(ralphDirectory, { recursive: true });
    const temporary = join(ralphDirectory, `.plan.json.${process.pid}.tmp`);
    try {
      await writeFile(temporary, candidate, { flag: "wx" });
      await rename(temporary, destination);
    } finally {
      await rm(temporary, { force: true });
    }
    return destination;
  }
}
