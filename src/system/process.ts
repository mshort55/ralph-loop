import { open } from "node:fs/promises";
import { $, type Options } from "zx";

export interface ProcessResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  signal: NodeJS.Signals | null;
}

export interface ProcessOptions {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  input?: string;
  timeoutMs?: number;
}

export interface FileProcessOptions extends ProcessOptions {
  logPath: string;
  append?: boolean;
}

function zxOptions(options: ProcessOptions): Partial<Options> {
  const result: Partial<Options> = {
    env: options.env ?? process.env,
    shell: "/bin/bash",
    detached: true,
    kill: async (pid, signal = "SIGTERM") => {
      process.kill(-Number(pid), signal);
    },
    timeoutSignal: "SIGTERM",
    nothrow: true,
    quiet: true,
  };
  if (options.cwd !== undefined) result.cwd = options.cwd;
  if (options.input !== undefined) result.input = options.input;
  if (options.timeoutMs !== undefined)
    result.timeout = `${options.timeoutMs}ms`;
  return result;
}

export class ProcessRunner {
  async available(
    command: string,
    env: NodeJS.ProcessEnv = process.env,
  ): Promise<boolean> {
    return (
      (await this.capture("command", ["-v", command], { env })).exitCode === 0
    );
  }

  async capture(
    command: string,
    args: string[],
    options: ProcessOptions = {},
  ): Promise<ProcessResult> {
    const output = await $(zxOptions(options))`${command} ${args}`;
    return {
      exitCode: output.exitCode ?? 1,
      stdout: output.stdout,
      stderr: output.stderr,
      signal: output.signal,
    };
  }

  async toFile(
    command: string,
    args: string[],
    options: FileProcessOptions,
  ): Promise<ProcessResult> {
    const handle = await open(options.logPath, options.append ? "a" : "w");
    try {
      const output = await $({
        ...zxOptions(options),
        stdio: ["pipe", handle.fd, handle.fd],
      })`${command} ${args}`;
      return {
        exitCode: output.exitCode ?? 1,
        stdout: output.stdout,
        stderr: output.stderr,
        signal: output.signal,
      };
    } finally {
      await handle.close();
    }
  }
}
