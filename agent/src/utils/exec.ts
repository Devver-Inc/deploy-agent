import { $ } from "bun";
import { assertSafeShellCommand } from "./validation";

export interface ExecResult {
  success: boolean;
  stdout: string;
  stderr: string;
  exitCode: number;
}

// User code (install/build/start) never inherits the agent's env: DEVVER_SECRET
// and the connection strings live there.
export function userEnv(
  env: Record<string, string> = {},
): Record<string, string> {
  return {
    PATH: process.env.PATH ?? "/usr/local/bin:/usr/bin:/bin",
    HOME: "/home/deploy",
    LANG: process.env.LANG ?? "C.UTF-8",
    TZ: process.env.TZ ?? "UTC",
    ...env,
  };
}

export async function exec(
  command: string,
  cwd?: string,
  options?: {
    unsafe?: boolean;
    env?: Record<string, string>;
    user?: string;
  },
): Promise<ExecResult> {
  try {
    if (!options?.unsafe) {
      assertSafeShellCommand(command);
    }

    const shell = (
      options?.user
        ? $`su-exec ${options.user} sh -c ${command}`
        : $`sh -c ${command}`
    )
      .cwd(cwd ?? process.cwd())
      .quiet();
    const result = await (options?.env || options?.user
      ? shell.env(userEnv(options.env))
      : shell);
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
