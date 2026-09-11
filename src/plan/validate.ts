import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import {
  Ajv2020,
  type ErrorObject,
  type ValidateFunction,
} from "ajv/dist/2020.js";
import type { Plan, ValidationMode } from "./model.js";

const schemaPath = fileURLToPath(
  new URL("../../schema/ralph-plan.schema.json", import.meta.url),
);

let validatorPromise: Promise<ValidateFunction> | undefined;

async function validator(): Promise<ValidateFunction> {
  validatorPromise ??= readFile(schemaPath, "utf8").then((source) => {
    const ajv = new Ajv2020({ allErrors: true, strict: true });
    return ajv.compile(JSON.parse(source));
  });
  return validatorPromise;
}

function displayPath(error: ErrorObject): string {
  const path = error.instancePath
    .replaceAll(/\/([0-9]+)/g, "[$1]")
    .replaceAll(/\/([^/]+)/g, ".$1")
    .replace(/^\./, "");
  if (error.keyword === "required") {
    const missing = (error.params as { missingProperty: string })
      .missingProperty;
    return path ? `${path}.${missing}` : missing;
  }
  if (error.keyword === "additionalProperties") {
    const extra = (error.params as { additionalProperty: string })
      .additionalProperty;
    return path ? `${path}.${extra}` : extra;
  }
  return path || "$";
}

function schemaProblem(error: ErrorObject): string {
  const path = displayPath(error);
  switch (error.keyword) {
    case "required":
      return `${path}: missing required field`;
    case "additionalProperties":
      return `${path}: unknown field`;
    case "minItems":
      return `${path}: must contain at least ${(error.params as { limit: number }).limit} item(s)`;
    default:
      return `${path}: ${error.message}`;
  }
}

function validateInvariants(plan: Plan, mode: ValidationMode): string[] {
  const problems: string[] = [];
  const byId = new Map(plan.userStories.map((story) => [story.id, story]));
  const idIndexes = new Map<string, number>();
  const priorityIndexes = new Map<number, number>();

  for (const [index, story] of plan.userStories.entries()) {
    const path = `userStories[${index}]`;
    const expectedId = `US-${String(index + 1).padStart(3, "0")}`;
    if (story.id !== expectedId) {
      problems.push(
        `${path}.id: expected ${JSON.stringify(expectedId)} for Story order`,
      );
    }
    if (story.priority !== index + 1) {
      problems.push(`${path}.priority: expected ${index + 1} for Story order`);
    }
    const previousId = idIndexes.get(story.id);
    if (previousId !== undefined) {
      problems.push(
        `${path}.id: duplicate of userStories[${previousId}].id (${JSON.stringify(story.id)})`,
      );
    } else {
      idIndexes.set(story.id, index);
    }
    const previousPriority = priorityIndexes.get(story.priority);
    if (previousPriority !== undefined) {
      problems.push(
        `${path}.priority: duplicate of userStories[${previousPriority}].priority (${story.priority})`,
      );
    } else {
      priorityIndexes.set(story.priority, index);
    }
    if (mode === "conversion") {
      if (story.passes !== false)
        problems.push(`${path}.passes: conversion requires false`);
      if (story.notes !== "")
        problems.push(`${path}.notes: conversion requires an empty string`);
    }
  }

  for (const [index, story] of plan.userStories.entries()) {
    const seen = new Set<string>();
    for (const [dependencyIndex, dependency] of story.dependencies.entries()) {
      const path = `userStories[${index}].dependencies[${dependencyIndex}]`;
      if (seen.has(dependency)) {
        problems.push(
          `${path}: duplicate dependency ${JSON.stringify(dependency)}`,
        );
        continue;
      }
      seen.add(dependency);
      if (dependency === story.id) {
        problems.push(
          `${path}: ${JSON.stringify(dependency)} cannot depend on itself`,
        );
        continue;
      }
      const prerequisite = byId.get(dependency);
      if (!prerequisite) {
        problems.push(
          `${path}: ${JSON.stringify(dependency)} does not name an existing Story`,
        );
        continue;
      }
      if (story.passes && !prerequisite.passes) {
        problems.push(
          `${path}: ${JSON.stringify(dependency)} must pass before this Story can pass`,
        );
      }
      if (prerequisite.priority >= story.priority) {
        problems.push(
          `${path}: ${JSON.stringify(dependency)} has priority ${prerequisite.priority}, which is not earlier than ${story.priority}`,
        );
      }
    }
  }
  return problems;
}

export async function validatePlan(
  value: unknown,
  mode: ValidationMode,
): Promise<{ plan?: Plan; problems: string[] }> {
  const validate = await validator();
  if (!validate(value)) {
    return { problems: validate.errors!.map(schemaProblem) };
  }
  const plan = value as Plan;
  const problems = validateInvariants(plan, mode);
  return problems.length === 0 ? { plan, problems } : { problems };
}

export async function parsePlan(
  source: string,
  mode: ValidationMode,
): Promise<Plan> {
  let value: unknown;
  try {
    value = JSON.parse(source);
  } catch (error) {
    throw new Error(`invalid JSON: ${(error as SyntaxError).message}`);
  }
  const result = await validatePlan(value, mode);
  if (!result.plan)
    throw new Error(`invalid Ralph Plan:\n${result.problems.join("\n")}`);
  return result.plan;
}

export function allStoriesPassed(plan: Plan): boolean {
  return plan.userStories.every((story) => story.passes);
}

export function selectReadyStory(plan: Plan) {
  const passed = new Set(
    plan.userStories.filter((story) => story.passes).map((story) => story.id),
  );
  return plan.userStories
    .filter(
      (story) =>
        !story.passes &&
        story.dependencies.every((dependency) => passed.has(dependency)),
    )
    .sort((left, right) => left.priority - right.priority)[0];
}
