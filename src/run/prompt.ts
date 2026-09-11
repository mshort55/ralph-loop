import { readFile, readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import type { Story } from "../plan/model.js";

const promptTemplatePath = fileURLToPath(
  new URL("../../resources/prompt.md", import.meta.url),
);

export async function iterationPrompt(
  iteration: number,
  story: Story,
  repository: string,
  plan: string,
  logDirectory: string,
): Promise<string> {
  const entries = (await readdir(logDirectory))
    .filter(
      (name) => name.startsWith("iteration-") && name.includes(`-${story.id}`),
    )
    .sort()
    .map((name) => `- ${logDirectory}/${name}`);
  const previous =
    entries.length > 0
      ? entries.join("\n")
      : "(none; this is the first attempt for this Story)";
  const instructions = await readFile(promptTemplatePath, "utf8");
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
