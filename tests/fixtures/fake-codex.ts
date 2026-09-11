#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

const state = process.env.RALPH_FAKE_STATE;
if (!state) {
  process.stderr.write("fake-codex: RALPH_FAKE_STATE is required\n");
  process.exit(90);
}
await mkdir(state, { recursive: true });

if (process.argv[2] === "login") {
  process.exit(process.env.RALPH_FAKE_LOGIN_FAIL === "1" ? 1 : 0);
}

const countPath = join(state, "count");
let count = 1;
try {
  count = Number(await readFile(countPath, "utf8")) + 1;
} catch {}
await writeFile(countPath, `${count}\n`);
await writeFile(
  join(state, `argv.${count}.json`),
  JSON.stringify(process.argv.slice(2)),
);
let prompt = "";
for await (const chunk of process.stdin) prompt += chunk.toString();
await writeFile(join(state, `prompt.${count}`), prompt);
const review = prompt.startsWith("# Ralph Review");
const firstStory = prompt.includes('"id":"US-001"');

const args = process.argv.slice(2);
const cdIndex = args.indexOf("--cd");
const workingDirectory = cdIndex >= 0 ? args[cdIndex + 1] : undefined;
if (workingDirectory) process.chdir(workingDirectory);

const scenario = process.env.RALPH_FAKE_SCENARIO ?? "multi";
switch (scenario) {
  case "multi":
    if (!review) {
      await writeFile(
        firstStory ? "story-1.txt" : "story-2.txt",
        firstStory ? "one\n" : "two\n",
      );
    }
    break;
  case "retry":
    if (!review && firstStory) {
      await writeFile(
        "story-1.txt",
        prompt.startsWith("# Ralph Iteration 1") ? "wrong\n" : "one\n",
      );
    } else if (!review) {
      await writeFile("story-2.txt", "two\n");
    }
    break;
  case "one":
    if (!review) await writeFile("story-1.txt", "one\n");
    break;
  case "two":
    if (!review) await writeFile("story-2.txt", "two\n");
    break;
  case "review-repair":
    await writeFile("story-1.txt", review ? "one\n" : "wrong\n");
    break;
  case "review-fail":
    if (review) process.exit(42);
    await writeFile("story-1.txt", "one\n");
    break;
  case "review-mutate-plan":
    if (!review) {
      await writeFile("story-1.txt", "one\n");
      break;
    }
    {
      const path = ".ralph/plan.json";
      const plan = JSON.parse(await readFile(path, "utf8")) as {
        description: string;
      };
      plan.description += " changed";
      await writeFile(path, JSON.stringify(plan));
    }
    break;
  case "review-stage":
    if (!review) {
      await writeFile("story-1.txt", "one\n");
      break;
    }
    await writeFile("review-staged.txt", "staged\n");
    execFileSync("git", ["add", "review-staged.txt"]);
    break;
  case "none":
    break;
  case "mutate-plan": {
    const path = ".ralph/plan.json";
    const plan = JSON.parse(await readFile(path, "utf8")) as {
      description: string;
    };
    plan.description += " changed";
    await writeFile(path, JSON.stringify(plan));
    break;
  }
  case "switch-branch":
    execFileSync("git", ["switch", "-q", "-c", "agent-branch"]);
    break;
  case "commit":
    await writeFile("agent.txt", "agent\n");
    execFileSync("git", ["add", "agent.txt"]);
    execFileSync("git", ["commit", "-q", "-m", "agent-commit"]);
    break;
  case "stage":
    await writeFile("staged.txt", "staged\n");
    execFileSync("git", ["add", "staged.txt"]);
    break;
  case "remove-ignore":
    await writeFile(".ralph/.gitignore", "");
    break;
  case "fail":
    process.exit(42);
  case "slow":
    await new Promise((resolve) => setTimeout(resolve, 10_000));
    break;
  default:
    await appendFile(join(state, "unknown"), scenario);
    process.exit(91);
}

process.stdout.write(`${JSON.stringify({ type: "fake", iteration: count })}\n`);
