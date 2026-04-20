import { DeployError } from "./errors";

export interface ExecResult {
  success: boolean;
  stdout: string;
  stderr: string;
  exitCode: number;
}

export async function exec(
  bin: string,
  argv: readonly string[],
  cwd?: string,
  env?: Record<string, string>,
): Promise<ExecResult> {
  try {
    const options: {
      cwd?: string;
      stdout?: "pipe";
      stderr?: "pipe";
      env: Record<string, string>;
    } = {
      cwd: cwd ?? process.cwd(),
      stdout: "pipe",
      stderr: "pipe",
      env: env ?? {},
    };

    if (env) {
      options.env = { ...process.env as Record<string, string>, ...env };
    }

    const child = Bun.spawn([bin, ...argv], options);
    const [stdout, stderr] = await Promise.all([
      child.stdout?.text() ?? "",
      child.stderr?.text() ?? "",
    ]);

    const exitCode = await child.exited;

    return {
      success: exitCode === 0,
      stdout,
      stderr,
      exitCode,
    };
  } catch (error) {
    const err = DeployError.wrap(error);
    return {
      success: false,
      stdout: "",
      stderr: err.message,
      exitCode: 1,
    };
  }
}

export async function execOrThrow(
  bin: string,
  argv: readonly string[],
  cwd?: string,
  env?: Record<string, string>,
): Promise<string> {
  const result = await exec(bin, argv, cwd, env);

  if (!result.success) {
    throw DeployError.commandFailed(
      `Command failed: ${bin} ${argv.join(" ")}\n${result.stderr}`,
      { context: { bin, argv: [...argv], cwd, exitCode: result.exitCode } }
    );
  }

  return result.stdout;
}