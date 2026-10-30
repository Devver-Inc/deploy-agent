export interface RunResult {
  ok: boolean;
  code: number;
  stdout: string;
  stderr: string;
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

export async function run(
  argv: string[],
  opts: { cwd?: string; env?: Record<string, string>; user?: string } = {},
): Promise<RunResult> {
  const cmd = opts.user ? ["su-exec", opts.user, ...argv] : argv;
  const env = opts.user ? userEnv(opts.env) : (opts.env ?? process.env);
  try {
    const proc = Bun.spawn(cmd, { cwd: opts.cwd, env, stdout: "pipe", stderr: "pipe" });
    const [stdout, stderr, code] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);
    return { ok: code === 0, code, stdout, stderr };
  } catch (error) {
    return { ok: false, code: 127, stdout: "", stderr: String(error) };
  }
}

export async function runOrThrow(argv: string[], cwd?: string): Promise<string> {
  const result = await run(argv, { cwd });
  if (!result.ok) {
    throw new Error(`${argv.join(" ")} failed:\n${result.stderr || result.stdout}`);
  }
  return result.stdout;
}

export function runUserCommand(
  command: string,
  cwd: string,
  env: Record<string, string>,
): Promise<RunResult> {
  return run(["/bin/sh", "-c", command], { cwd, env, user: "deploy" });
}
