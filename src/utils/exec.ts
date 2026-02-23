import { $ } from "bun";
import { assertSafeShellCommand } from "./validation";

export interface ExecResult {
  success: boolean;
  stdout: string;
  stderr: string;
  exitCode: number;
}

export async function exec(
  command: string,
  cwd?: string,
  options?: { unsafe?: boolean },
): Promise<ExecResult> {
  try {
    if (!options?.unsafe) {
      assertSafeShellCommand(command);
    }

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
  options?: { unsafe?: boolean },
): Promise<string> {
  const result = await exec(command, cwd, options);
  if (!result.success)
    throw new Error(`Command failed: ${command}\n${result.stderr}`);
  return result.stdout;
}
