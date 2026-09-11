import { execFile } from "node:child_process";
import {
  lstat,
  mkdtemp,
  readFile,
  realpath,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { promisify } from "node:util";
import type { Plan, Story } from "../plan/model.js";
import { PlanStore } from "../plan/store.js";
import { validatePlan } from "../plan/validate.js";

const run = promisify(execFile);

interface CoverageEntry {
  source: string;
  disposition: "Story" | "Preserved non-goal" | "Plan boundary";
  targets: string[];
}

interface PrdDocument {
  title: string;
  project: string;
  branch: string;
  source: string;
  description: string;
  coverage: CoverageEntry[];
  stories: Story[];
  boundaries: string[];
}

interface MarkdownSection {
  heading: string;
  lines: string[];
}

const topLevelSections = [
  "Project",
  "Branch",
  "Source",
  "Description",
  "Source coverage",
  "Stories",
  "Plan boundaries",
] as const;

function problem(message: string): never {
  throw new Error(`invalid implementation PRD:\n${message}`);
}

function meaningful(lines: string[]): string[] {
  return lines.filter((line) => line.trim() !== "");
}

function text(lines: string[], name: string): string {
  const value = lines.join("\n").trim();
  if (value === "") problem(`${name}: must not be empty`);
  return value;
}

function unwrapCode(value: string): string {
  return value.replaceAll(/`([^`]*)`/g, "$1");
}

function sections(
  lines: string[],
  pattern: RegExp,
  name: string,
): MarkdownSection[] {
  const result: MarkdownSection[] = [];
  for (const line of lines) {
    const match = line.match(pattern);
    if (match) {
      result.push({ heading: match[1]!, lines: [] });
    } else if (result.length === 0) {
      if (line.trim() !== "") problem(`${name}: content precedes its heading`);
    } else {
      result.at(-1)!.lines.push(line);
    }
  }
  return result;
}

function exactSections(lines: string[]): Map<string, string[]> {
  const parsed = sections(lines, /^## (.+)$/, "document");
  const result = new Map<string, string[]>();
  for (const section of parsed) {
    if (!topLevelSections.includes(section.heading as never)) {
      problem(`## ${section.heading}: unknown section`);
    }
    if (result.has(section.heading)) {
      problem(`## ${section.heading}: duplicate section`);
    }
    result.set(section.heading, section.lines);
  }
  for (const heading of topLevelSections) {
    if (!result.has(heading)) problem(`## ${heading}: missing section`);
  }
  return result;
}

function list(lines: string[], name: string, checkbox = false): string[] {
  const values = meaningful(lines);
  if (values.length === 1 && /^(?:- )?None$/.test(values[0]!)) return [];
  return values.map((line, index) => {
    const prefix = checkbox ? "- [ ] " : "- ";
    if (!line.startsWith(prefix)) {
      problem(`${name}[${index}]: expected ${JSON.stringify(prefix.trim())}`);
    }
    const value = line.slice(prefix.length).trim();
    if (value === "") problem(`${name}[${index}]: must not be empty`);
    return unwrapCode(value);
  });
}

function storySectionMap(
  lines: string[],
  storyId: string,
): Map<string, string[]> {
  const headings = new Set([
    "Description",
    "Acceptance criteria",
    "Non-goals",
    "Checks",
    "References",
  ]);
  const result = new Map<string, string[]>();
  let current: string | undefined;
  for (const line of lines) {
    const match = line.match(/^\*\*(.+)\*\*$/);
    if (match) {
      if (!headings.has(match[1]!)) {
        problem(`${storyId}: unknown field ${JSON.stringify(match[1])}`);
      }
      current = match[1]!;
      if (result.has(current))
        problem(`${storyId}.${current}: duplicate field`);
      result.set(current, []);
    } else if (current !== undefined) {
      result.get(current)!.push(line);
    }
  }
  for (const heading of headings) {
    if (!result.has(heading)) problem(`${storyId}.${heading}: missing field`);
  }
  return result;
}

function metadata(lines: string[], storyId: string) {
  const priorityLine = lines.find((line) => line.startsWith("**Priority:**"));
  const dependencyLine = lines.find((line) =>
    line.startsWith("**Dependencies:**"),
  );
  if (!priorityLine) problem(`${storyId}.Priority: missing field`);
  if (!dependencyLine) problem(`${storyId}.Dependencies: missing field`);
  const prioritySource = priorityLine.slice("**Priority:**".length).trim();
  if (!/^[1-9][0-9]*$/.test(prioritySource)) {
    problem(`${storyId}.Priority: expected a positive integer`);
  }
  const dependencySource = dependencyLine
    .slice("**Dependencies:**".length)
    .trim();
  if (dependencySource === "") problem(`${storyId}.Dependencies: empty field`);
  const dependencies =
    dependencySource === "None"
      ? []
      : dependencySource.split(",").map((value) => value.trim());
  if (dependencies.some((value) => value === "")) {
    problem(`${storyId}.Dependencies: empty dependency`);
  }
  return { priority: Number(prioritySource), dependencies };
}

function parseStories(lines: string[]): Story[] {
  const parsed = sections(lines, /^### (US-[0-9]{3}: .+)$/, "Stories");
  if (parsed.length === 0) problem("Stories: must contain at least one Story");
  return parsed.map((section) => {
    const separator = section.heading.indexOf(": ");
    const id = section.heading.slice(0, separator);
    const title = section.heading.slice(separator + 2);
    const fields = storySectionMap(section.lines, id);
    const values = metadata(section.lines, id);
    return {
      id,
      title,
      description: text(fields.get("Description")!, `${id}.Description`),
      acceptanceCriteria: list(
        fields.get("Acceptance criteria")!,
        `${id}.Acceptance criteria`,
        true,
      ),
      nonGoals: list(fields.get("Non-goals")!, `${id}.Non-goals`),
      checks: list(fields.get("Checks")!, `${id}.Checks`),
      references: list(fields.get("References")!, `${id}.References`),
      dependencies: values.dependencies,
      priority: values.priority,
      passes: false,
      notes: "",
    };
  });
}

function tableCells(line: string): string[] {
  return line
    .slice(1, -1)
    .split("|")
    .map((cell) => cell.trim());
}

function parseCoverage(lines: string[]): CoverageEntry[] {
  const rows = meaningful(lines).filter((line) => line.startsWith("|"));
  if (rows.length < 3)
    problem("Source coverage: expected a header and entries");
  const header = tableCells(rows[0]!);
  if (header.join("|") !== "Source item|Disposition|Story or boundary") {
    problem("Source coverage: invalid table header");
  }
  if (!tableCells(rows[1]!).every((cell) => /^:?-{3,}:?$/.test(cell))) {
    problem("Source coverage: invalid table separator");
  }
  return rows.slice(2).map((line, index) => {
    const cells = tableCells(line);
    if (cells.length !== 3) {
      problem(`Source coverage row ${index + 1}: expected three columns`);
    }
    const disposition = cells[1];
    if (
      disposition !== "Story" &&
      disposition !== "Preserved non-goal" &&
      disposition !== "Plan boundary"
    ) {
      problem(
        `Source coverage row ${index + 1}: invalid disposition ${JSON.stringify(disposition)}`,
      );
    }
    const targets = cells[2]!.split(",").map((value) => value.trim());
    if (cells[0] === "" || targets.some((value) => value === "")) {
      problem(`Source coverage row ${index + 1}: empty field`);
    }
    return { source: unwrapCode(cells[0]!), disposition, targets };
  });
}

function parseBoundaries(lines: string[]): string[] {
  const values = meaningful(lines);
  if (values.length === 1 && values[0] === "None") return [];
  const parsed = sections(lines, /^### (PB-[0-9]{3}: .+)$/, "Plan boundaries");
  if (parsed.length === 0) {
    problem("Plan boundaries: expected a PB-### section or None");
  }
  for (const section of parsed) {
    for (const field of [
      "Disposition",
      "Reason",
      "Source",
      "Command",
      "Prerequisites",
      "Trigger or owner",
    ]) {
      if (!section.lines.some((line) => line.startsWith(`**${field}:**`))) {
        problem(`${section.heading}.${field}: missing field`);
      }
    }
  }
  return parsed.map((section) => section.heading.split(": ", 1)[0]!);
}

function validateCoverage(document: PrdDocument): void {
  const storyIds = new Set(document.stories.map((story) => story.id));
  const boundaryIds = new Set(document.boundaries);
  const coveredStories = new Set<string>();
  const coveredBoundaries = new Set<string>();
  for (const [index, entry] of document.coverage.entries()) {
    for (const target of entry.targets) {
      if (entry.disposition === "Story") {
        if (!storyIds.has(target)) {
          problem(`Source coverage row ${index + 1}: unknown Story ${target}`);
        }
        coveredStories.add(target);
      } else if (entry.disposition === "Plan boundary") {
        if (!boundaryIds.has(target)) {
          problem(
            `Source coverage row ${index + 1}: unknown boundary ${target}`,
          );
        }
        coveredBoundaries.add(target);
      } else if (target !== "Project") {
        problem(
          `Source coverage row ${index + 1}: preserved non-goal must target Project`,
        );
      }
    }
  }
  for (const story of storyIds) {
    if (!coveredStories.has(story))
      problem(`${story}: missing source coverage`);
  }
  for (const boundary of boundaryIds) {
    if (!coveredBoundaries.has(boundary)) {
      problem(`${boundary}: missing source coverage`);
    }
  }
}

function parseDocument(source: string): PrdDocument {
  const lines = source.replaceAll("\r\n", "\n").split("\n");
  const titleMatch = lines[0]?.match(/^# PRD: (.+)$/);
  if (!titleMatch) problem("line 1: expected '# PRD: <Project>'");
  const values = exactSections(lines.slice(1));
  const project = text(values.get("Project")!, "Project");
  if (titleMatch[1] !== project) problem("Project: does not match PRD title");
  const document: PrdDocument = {
    title: titleMatch[1],
    project,
    branch: unwrapCode(text(values.get("Branch")!, "Branch")),
    source: unwrapCode(text(values.get("Source")!, "Source")),
    description: text(values.get("Description")!, "Description"),
    coverage: parseCoverage(values.get("Source coverage")!),
    stories: parseStories(values.get("Stories")!),
    boundaries: parseBoundaries(values.get("Plan boundaries")!),
  };
  validateCoverage(document);
  return document;
}

function referencedPath(value: string, prefix: string): string | undefined {
  if (!value.startsWith(prefix)) return undefined;
  const reference = value.slice(prefix.length).trim();
  return reference.split(" § ", 1)[0]!.trim();
}

function referenceHeading(value: string): string | undefined {
  const separator = value.indexOf(" § ");
  return separator === -1 ? undefined : value.slice(separator + 3).trim();
}

function fromRepository(repository: string, path: string): string {
  return isAbsolute(path) ? path : resolve(repository, path);
}

async function requirePath(path: string, label: string): Promise<void> {
  try {
    await stat(path);
  } catch {
    problem(`${label}: path does not exist: ${path}`);
  }
}

async function requireHeading(
  path: string,
  heading: string,
  label: string,
): Promise<void> {
  const source = await readFile(path, "utf8");
  const headings = source
    .split(/\r?\n/)
    .map((line) => line.match(/^#{1,6} (.+?)(?: #+)?$/)?.[1])
    .filter((value): value is string => value !== undefined);
  if (!headings.includes(heading)) {
    problem(`${label}: heading not found: ${heading}`);
  }
}

async function validateReferences(
  repository: string,
  document: PrdDocument,
): Promise<void> {
  await requirePath(fromRepository(repository, document.source), "Source");
  for (const story of document.stories) {
    let sourceReferences = 0;
    let repositoryReferences = 0;
    for (const reference of story.references) {
      const sourcePath = referencedPath(reference, "Source:");
      const repositoryPath = referencedPath(reference, "Repository:");
      if (sourcePath !== undefined) {
        sourceReferences += 1;
        const resolved = fromRepository(repository, sourcePath);
        await requirePath(resolved, `${story.id} Source reference`);
        const heading = referenceHeading(reference);
        if (heading !== undefined) {
          await requireHeading(
            resolved,
            heading,
            `${story.id} Source reference`,
          );
        }
      } else if (repositoryPath !== undefined) {
        repositoryReferences += 1;
        await requirePath(
          fromRepository(repository, repositoryPath),
          `${story.id} Repository reference`,
        );
      } else {
        problem(`${story.id}.References: expected Source: or Repository:`);
      }
    }
    if (sourceReferences === 0)
      problem(`${story.id}: missing Source reference`);
    if (repositoryReferences === 0) {
      problem(`${story.id}: missing Repository reference`);
    }
  }
}

function planFrom(document: PrdDocument): Plan {
  return {
    schemaVersion: 1,
    project: document.project,
    branchName: document.branch,
    description: document.description,
    userStories: document.stories,
  };
}

async function validatedPlan(document: PrdDocument): Promise<Plan> {
  const plan = planFrom(document);
  const result = await validatePlan(plan, "conversion");
  if (!result.plan) {
    problem(result.problems.join("\n"));
  }
  return result.plan;
}

export async function compilePrd(source: string): Promise<Plan> {
  return validatedPlan(parseDocument(source));
}

export class PrdCompiler {
  constructor(private readonly plans = new PlanStore()) {}

  async validate(repoArgument: string, prdArgument: string): Promise<Plan> {
    const repository = await realpath(resolve(repoArgument));
    const suppliedPrdPath = resolve(prdArgument);
    if ((await lstat(suppliedPrdPath)).isSymbolicLink()) {
      problem(`symlinked PRD is not allowed: ${suppliedPrdPath}`);
    }
    const prdPath = await realpath(suppliedPrdPath);
    const topLevel = (
      await run("git", ["-C", repository, "rev-parse", "--show-toplevel"])
    ).stdout.trim();
    if ((await realpath(topLevel)) !== repository) {
      problem(`Target Repository is not a Git repository root: ${repository}`);
    }
    const prdsDirectory = join(repository, ".ralph", "prds");
    const location = relative(prdsDirectory, prdPath);
    if (
      location === "" ||
      location === ".." ||
      location.startsWith(`..${sep}`)
    ) {
      problem(`PRD must be a file under ${prdsDirectory}`);
    }
    const repositoryLocation = relative(repository, prdPath);
    const tracked = await run(
      "git",
      [
        "-C",
        repository,
        "ls-files",
        "--error-unmatch",
        "--",
        repositoryLocation,
      ],
      { encoding: "utf8" },
    ).catch(() => undefined);
    if (!tracked) problem(`PRD must be tracked: ${prdPath}`);
    const changed = await run(
      "git",
      ["-C", repository, "diff", "--quiet", "HEAD", "--", repositoryLocation],
      { encoding: "utf8" },
    ).then(
      () => false,
      () => true,
    );
    if (changed) problem(`PRD must be unchanged: ${prdPath}`);
    const source = await readFile(prdPath, "utf8");
    const document = parseDocument(source);
    const branch = (
      await run("git", ["-C", repository, "symbolic-ref", "--short", "HEAD"])
    ).stdout.trim();
    if (branch !== document.branch) {
      problem(
        `Branch ${document.branch} does not match current branch ${branch}`,
      );
    }
    await validateReferences(repository, document);
    return validatedPlan(document);
  }

  async install(repoArgument: string, prdArgument: string): Promise<string> {
    const plan = await this.validate(repoArgument, prdArgument);
    const temporaryDirectory = await mkdtemp(join(tmpdir(), "ralph-prd-"));
    const candidate = join(temporaryDirectory, "plan.json");
    try {
      await writeFile(candidate, `${JSON.stringify(plan, null, 2)}\n`);
      return await this.plans.install(repoArgument, candidate);
    } finally {
      await rm(temporaryDirectory, { recursive: true, force: true });
    }
  }
}
