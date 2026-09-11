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
const status = await readFile("/proc/self/status", "utf8");
await writeFile(
  join(state, `caps.${count}`),
  status
    .split("\n")
    .filter((line) => line.startsWith("CapInh:") || line.startsWith("CapAmb:"))
    .join("\n") + "\n",
);

let prompt = "";
for await (const chunk of process.stdin) prompt += chunk.toString();
await writeFile(join(state, `prompt.${count}`), prompt);

const args = process.argv.slice(2);
const cdIndex = args.indexOf("--cd");
const workingDirectory = cdIndex >= 0 ? args[cdIndex + 1] : undefined;
if (workingDirectory) process.chdir(workingDirectory);

const scenario = process.env.RALPH_FAKE_SCENARIO ?? "multi";
switch (scenario) {
  case "multi":
    await writeFile(
      count === 1 ? "story-1.txt" : "story-2.txt",
      count === 1 ? "one\n" : "two\n",
    );
    break;
  case "retry":
    if (count === 1) await writeFile("story-1.txt", "wrong\n");
    else if (count === 2) await writeFile("story-1.txt", "one\n");
    else await writeFile("story-2.txt", "two\n");
    break;
  case "one":
    await writeFile("story-1.txt", "one\n");
    break;
  case "two":
    await writeFile("story-2.txt", "two\n");
    break;
  case "none":
    break;
  case "mutate-plan": {
    const path = ".ralph/prd.json";
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
