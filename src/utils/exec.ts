import { $ } from "bun";

export interface ExecResult {
  success: boolean;
  stdout: string;
  stderr: string;
  exitCode: number;
}

export async function exec(command: string, cwd?: string): Promise<ExecResult> {
  try {
    const result = await $`sh -c ${command}`.cwd(cwd ?? process.cwd()).quiet();
    return {
      success: result.exitCode === 0,
      stdout: result.stdout.toString(),
      stderr: result.stderr.toString(),
      exitCode: result.exitCode,
    };
  } catch (error: any) {
    return {
      success: false,
      stdout: error.stdout?.toString() ?? "",
      stderr: error.stderr?.toString() ?? error.message,
      exitCode: error.exitCode ?? 1,
    };
  }
}

export async function execOrThrow(
  command: string,
  cwd?: string,
): Promise<string> {
  const result = await exec(command, cwd);
  if (!result.success)
    throw new Error(`Command failed: ${command}\n${result.stderr}`);
  return result.stdout;
}
