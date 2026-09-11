import { PlanStore } from "./plan/store.js";
import type { ValidationMode } from "./plan/model.js";
import { runPlan } from "./run/run-plan.js";

export interface CliOutput {
  stdout: (line: string) => void;
  stderr: (line: string) => void;
}

const consoleOutput: CliOutput = {
  stdout: console.log,
  stderr: (line) => console.error(line),
};

function usage(): never {
  throw new Error(
    "Usage: ralph run --repo PATH --plan PATH --iterations N | ralph plan validate [--mode conversion|runtime] PATH | ralph plan install --repo PATH --from PATH",
  );
}

function namedArguments(
  args: string[],
  names: string[],
): Record<string, string> {
  const values: Record<string, string> = {};
  for (let index = 0; index < args.length; index += 2) {
    const name = args[index];
    const value = args[index + 1];
    if (!name?.startsWith("--") || !names.includes(name))
      throw new Error(`unknown argument: ${name ?? ""}`);
    if (value === undefined) throw new Error(`missing value for ${name}`);
    if (values[name] !== undefined) throw new Error(`duplicate ${name}`);
    values[name] = value;
  }
  for (const name of names) {
    if (values[name] === undefined) throw new Error(`missing ${name}`);
  }
  return values;
}

async function validateCommand(args: string[]): Promise<void> {
  let mode: ValidationMode = "conversion";
  const positional: string[] = [];
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === "--mode") {
      const value = args[++index];
      if (value !== "conversion" && value !== "runtime")
        throw new Error(`invalid --mode: ${value ?? ""}`);
      mode = value;
    } else {
      positional.push(args[index]!);
    }
  }
  if (positional.length === 0) throw new Error("missing Plan path");
  if (positional.length > 1)
    throw new Error(`unexpected argument: ${positional[1]}`);
  await new PlanStore().read(positional[0]!, mode);
}

async function dispatch(args: string[], output: CliOutput): Promise<void> {
  const [operation, subcommand, ...rest] = args;
  if (!operation) usage();
  if (operation === "run") {
    const values = namedArguments(
      [subcommand, ...rest].filter(
        (value): value is string => value !== undefined,
      ),
      ["--repo", "--plan", "--iterations"],
    );
    if (!/^[1-9][0-9]*$/.test(values["--iterations"]!)) {
      throw new Error(`invalid --iterations: ${values["--iterations"]}`);
    }
    await runPlan(
      {
        repo: values["--repo"]!,
        plan: values["--plan"]!,
        iterations: Number(values["--iterations"]),
      },
      { writeLine: output.stdout },
    );
    return;
  }
  if (operation !== "plan") throw new Error(`unknown operation: ${operation}`);
  if (!subcommand) usage();
  if (subcommand === "validate") {
    await validateCommand(rest);
    return;
  }
  if (subcommand === "install") {
    const values = namedArguments(rest, ["--repo", "--from"]);
    await new PlanStore().install(values["--repo"]!, values["--from"]!);
    return;
  }
  throw new Error(`unknown Plan operation: ${subcommand}`);
}

export async function main(
  args: string[],
  output: CliOutput = consoleOutput,
): Promise<number> {
  try {
    await dispatch(args, output);
    return 0;
  } catch (error) {
    output.stderr(`Failed: ${(error as Error).message}`);
    return 1;
  }
}
