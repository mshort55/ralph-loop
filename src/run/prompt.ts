import { readFile, readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import type { Story } from "../plan/model.js";

const implementationInstructionsPath = fileURLToPath(
  new URL("../../prompts/implement-story.md", import.meta.url),
);
const reviewInstructionsPath = fileURLToPath(
  new URL("../../prompts/review-and-repair-story.md", import.meta.url),
);

async function previousLogs(
  storyId: string,
  logDirectory: string,
): Promise<string> {
  const entries = (await readdir(logDirectory))
    .filter(
      (name) => name.startsWith("iteration-") && name.includes(`-${storyId}`),
    )
    .sort()
    .map((name) => `- ${logDirectory}/${name}`);
  return entries.length > 0
    ? entries.join("\n")
    : "(none; this is the first attempt for this Story)";
}

export async function implementationPrompt(
  iteration: number,
  story: Story,
  repository: string,
  plan: string,
  logDirectory: string,
): Promise<string> {
  const previous = await previousLogs(story.id, logDirectory);
  const instructions = await readFile(implementationInstructionsPath, "utf8");
  return `# Ralph Iteration ${iteration}

## Story

\`\`\`json
${JSON.stringify(story)}
\`\`\`

## Paths
Target Repository: ${repository}
Plan: ${plan}
Log directory: ${logDirectory}

## Previous attempt logs for ${story.id}
${previous}

## Instructions
${instructions}`;
}

export async function reviewPrompt(
  iteration: number,
  story: Story,
  repository: string,
  plan: string,
  logDirectory: string,
): Promise<string> {
  const previous = await previousLogs(story.id, logDirectory);
  const instructions = await readFile(reviewInstructionsPath, "utf8");
  return `# Ralph Review ${iteration}

## Story

\`\`\`json
${JSON.stringify(story)}
\`\`\`

## Paths
Target Repository: ${repository}
Plan: ${plan}
Log directory: ${logDirectory}

## Current and previous logs for ${story.id}
${previous}

## Instructions
${instructions}`;
}
