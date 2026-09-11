import { lstat, mkdir, readFile, realpath, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { PlanStore, digest } from "../plan/store.js";
import { allStoriesPassed, selectReadyStory } from "../plan/validate.js";
import { TargetRepository } from "../system/git.js";
import { acquireRunLock, type ReleaseLock } from "../system/lock.js";
import { ProcessRunner } from "../system/process.js";
import { implementationPrompt, reviewPrompt } from "./prompt.js";

const DEFAULTS = {
  model: "gpt-5.6-luna",
  reasoning: 'model_reasoning_effort="high"',
  sessionTimeoutMs: 3_600_000,
  checkTimeoutMs: 900_000,
};

export interface RunOptions {
  repo: string;
  plan: string;
  iterations: number;
}

export interface RunDependencies {
  env?: NodeJS.ProcessEnv;
  writeLine?: (line: string) => void;
  processes?: ProcessRunner;
  plans?: PlanStore;
  lock?: (path: string) => Promise<ReleaseLock>;
  now?: () => Date;
  sessionTimeoutMs?: number;
  checkTimeoutMs?: number;
}

async function ensureNotSymlink(path: string): Promise<void> {
  try {
    if ((await lstat(path)).isSymbolicLink())
      throw new Error(`symlinked .ralph directory is not allowed`);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
}

function runIdentifier(now: Date): string {
  return `${now.toISOString().replaceAll(/[-:]/g, "").slice(0, 15)}-${process.pid}`;
}

export async function runPlan(
  options: RunOptions,
  supplied: RunDependencies = {},
): Promise<void> {
  if (!Number.isSafeInteger(options.iterations) || options.iterations <= 0) {
    throw new Error(`invalid --iterations: ${options.iterations}`);
  }
  const processes = supplied.processes ?? new ProcessRunner();
  const plans = supplied.plans ?? new PlanStore();
  const writeLine = supplied.writeLine ?? console.log;
  const env = supplied.env ?? process.env;
  const repositoryPath = await realpath(resolve(options.repo));
  await ensureNotSymlink(join(repositoryPath, ".ralph"));
  const planPath = await realpath(resolve(options.plan));
  if (planPath !== join(repositoryPath, ".ralph", "plan.json")) {
    throw new Error("Plan must be <Target Repository>/.ralph/plan.json");
  }
  for (const command of ["bash", "git"]) {
    if (!(await processes.available(command, env)))
      throw new Error(`required executable not found: ${command}`);
  }
  const repository = await TargetRepository.open(repositoryPath, processes);
  let current = await plans.read(planPath, "runtime");
  const planBranch = current.plan.branchName;
  if ((await repository.branch()) !== planBranch) {
    throw new Error(
      `current branch ${await repository.branch()} does not match Plan branch ${planBranch}`,
    );
  }
  await repository.verifyIdentity();
  if (!(await repository.planIgnored()))
    throw new Error(`.ralph/plan.json is not ignored in ${repositoryPath}`);
  if ((await repository.dirty()) || (await repository.indexDirty())) {
    throw new Error("worktree and index must be clean");
  }

  const release = await (supplied.lock ?? acquireRunLock)(
    join(repositoryPath, ".ralph", "run"),
  );
  try {
    current = await reconcile(repository, plans, planPath, current, writeLine);
    if (allStoriesPassed(current.plan)) {
      writeLine("All Stories machine-complete");
      return;
    }
    if (!(await processes.available("codex", env)))
      throw new Error("required executable not found: codex");
    if (
      (await processes.capture("codex", ["login", "status"], { env }))
        .exitCode !== 0
    ) {
      throw new Error("Codex is not logged in");
    }
    const logDirectory = join(
      repositoryPath,
      ".ralph",
      "runs",
      runIdentifier((supplied.now ?? (() => new Date()))()),
    );
    await mkdir(logDirectory, { recursive: true });
    writeLine("Ralph Run");
    writeLine(`  repository: ${repositoryPath}`);
    writeLine(`  plan: ${planPath}`);
    writeLine(`  branch: ${planBranch}`);
    writeLine(`  Iteration budget: ${options.iterations}`);
    writeLine(`  logs: ${logDirectory}`);

    for (let iteration = 1; iteration <= options.iterations; iteration += 1) {
      current = await plans.read(planPath, "runtime");
      if (allStoriesPassed(current.plan)) {
        writeLine("All Stories machine-complete");
        writeLine(`Logs: ${logDirectory}`);
        return;
      }
      const story = selectReadyStory(current.plan)!;
      const tag = String(iteration).padStart(3, "0");
      writeLine("");
      writeLine(`Iteration ${iteration} of ${options.iterations}: ${story.id}`);
      const promptPath = join(
        logDirectory,
        `iteration-${tag}-${story.id}.prompt`,
      );
      const jsonlPath = join(
        logDirectory,
        `iteration-${tag}-${story.id}.jsonl`,
      );
      const checksPath = join(
        logDirectory,
        `iteration-${tag}-${story.id}-checks.log`,
      );
      const prompt = await implementationPrompt(
        iteration,
        story,
        repositoryPath,
        planPath,
        logDirectory,
      );
      await writeFile(promptPath, prompt);
      const snapshot = await repository.snapshot(current.digest);
      const agent = await runCodexSession(
        processes,
        repositoryPath,
        env,
        prompt,
        jsonlPath,
        supplied.sessionTimeoutMs ?? DEFAULTS.sessionTimeoutMs,
      );
      await repository.assertUnchanged(
        snapshot,
        digest(await readFile(planPath)),
      );
      if (agent.exitCode !== 0) {
        writeLine(
          `Codex failed (exit ${agent.exitCode}); retaining ${jsonlPath}`,
        );
        continue;
      }
      const reviewPromptPath = join(
        logDirectory,
        `iteration-${tag}-${story.id}-review.prompt`,
      );
      const reviewJsonlPath = join(
        logDirectory,
        `iteration-${tag}-${story.id}-review.jsonl`,
      );
      const review = await reviewPrompt(
        iteration,
        story,
        repositoryPath,
        planPath,
        logDirectory,
      );
      await writeFile(reviewPromptPath, review);
      const reviewer = await runCodexSession(
        processes,
        repositoryPath,
        env,
        review,
        reviewJsonlPath,
        supplied.sessionTimeoutMs ?? DEFAULTS.sessionTimeoutMs,
      );
      await repository.assertUnchanged(
        snapshot,
        digest(await readFile(planPath)),
      );
      if (reviewer.exitCode !== 0) {
        writeLine(
          `Codex review failed (exit ${reviewer.exitCode}); retaining ${reviewJsonlPath}`,
        );
        continue;
      }
      let checksPassed = true;
      await writeFile(checksPath, "");
      for (const check of story.checks) {
        await writeFile(
          checksPath,
          `+ timeout ${(supplied.checkTimeoutMs ?? DEFAULTS.checkTimeoutMs) / 1000} bash -lc ${JSON.stringify(check)}\n`,
          { flag: "a" },
        );
        const result = await processes.toFile("bash", ["-lc", check], {
          cwd: repositoryPath,
          env,
          logPath: checksPath,
          append: true,
          timeoutMs: supplied.checkTimeoutMs ?? DEFAULTS.checkTimeoutMs,
        });
        if (result.exitCode !== 0) {
          await writeFile(checksPath, `Check failed: ${check}\n`, {
            flag: "a",
          });
          checksPassed = false;
          break;
        }
      }
      await repository.assertUnchanged(
        snapshot,
        digest(await readFile(planPath)),
      );
      if (!checksPassed) {
        writeLine(`Checks failed for ${story.id}; retaining ${checksPath}`);
        continue;
      }
      let notes: string;
      if (await repository.dirty()) {
        const commit = await repository.commitStory(story.id, story.title);
        notes = `Committed ${commit}; logs ${logDirectory}`;
        await plans.complete(planPath, story.id, notes, current.digest);
        writeLine(`Story machine-complete: ${story.id} (${commit})`);
      } else {
        notes = `Already satisfied; logs ${logDirectory}`;
        await plans.complete(planPath, story.id, notes, current.digest);
        writeLine(`Story machine-complete without changes: ${story.id}`);
      }
    }
    current = await plans.read(planPath, "runtime");
    if (allStoriesPassed(current.plan)) {
      writeLine("All Stories machine-complete");
      writeLine(`Logs: ${logDirectory}`);
      return;
    }
    writeLine("");
    writeLine("Failed: Iteration budget exhausted with incomplete Stories");
    writeLine(`Logs: ${logDirectory}`);
    throw new Error("Iteration budget exhausted with incomplete Stories");
  } finally {
    await release();
  }
}

async function runCodexSession(
  processes: ProcessRunner,
  repository: string,
  env: NodeJS.ProcessEnv,
  prompt: string,
  logPath: string,
  timeoutMs: number,
) {
  return processes.toFile(
    "codex",
    [
      "exec",
      "--cd",
      repository,
      "--ephemeral",
      "--model",
      DEFAULTS.model,
      "--config",
      DEFAULTS.reasoning,
      "--dangerously-bypass-approvals-and-sandbox",
      "--json",
      "-",
    ],
    { cwd: repository, env, input: prompt, logPath, timeoutMs },
  );
}

async function reconcile(
  repository: TargetRepository,
  plans: PlanStore,
  planPath: string,
  current: Awaited<ReturnType<PlanStore["read"]>>,
  writeLine: (line: string) => void,
) {
  const commit = await repository.lastCommit();
  if (!commit.storyId) return current;
  const story = current.plan.userStories.find(
    (candidate) => candidate.id === commit.storyId,
  );
  if (!story || story.passes) return current;
  if (selectReadyStory(current.plan)?.id !== story.id) {
    throw new Error(
      `cannot reconcile ${story.id}: it is not the next ready Story`,
    );
  }
  if (commit.subject !== `ralph(${story.id}): ${story.title}`) {
    throw new Error(
      `cannot reconcile ${story.id}: commit subject does not match Story`,
    );
  }
  await plans.complete(
    planPath,
    story.id,
    `Recovered commit ${commit.hash}`,
    current.digest,
  );
  writeLine(`Reconciled ${story.id} from commit ${commit.hash}`);
  return plans.read(planPath, "runtime");
}
