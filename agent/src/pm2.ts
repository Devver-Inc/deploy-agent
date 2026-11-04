import { run, runOrThrow, userEnv } from "./utils/exec";

export type Pm2Status = "online" | "stopped" | "errored" | "launching" | string;

// The PM2 daemon holds the agent's env and merges the CLI env into the app,
// so the shell keeps only the names we set. Values never touch disk.
export function wrapperScript(command: string, env: Record<string, string>): string {
  const keep = Object.keys(env)
    .filter((name) => /^[A-Za-z_][A-Za-z0-9_]*$/.test(name))
    .map((name) => `${name}="$${name}"`)
    .join(" ");
  const quoted = `'${command.replaceAll("'", `'\\''`)}'`;
  return `exec env -i ${keep} /bin/sh -c ${quoted}`;
}

export async function start(
  name: string,
  command: string,
  cwd: string,
  env: Record<string, string>,
): Promise<void> {
  const appEnv = userEnv(env);
  const result = await run(
    [
      "pm2", "start", "/bin/sh", "--name", name, "--cwd", cwd,
      "--interpreter", "none", "--uid", "deploy", "--gid", "deploy",
      "--kill-timeout", "5000", "--max-restarts", "5", "--log", logFile(name),
      "--", "-c", wrapperScript(command, appEnv),
    ],
    { env: { ...appEnv, PM2_HOME: process.env.PM2_HOME ?? "/root/.pm2" } },
  );
  if (!result.ok) throw new Error(`pm2 start failed:\n${result.stderr || result.stdout}`);
}

export async function list(): Promise<Map<string, Pm2Status>> {
  const raw = await runOrThrow(["pm2", "jlist"]);
  const procs: { name: string; pm2_env?: { status?: string } }[] = JSON.parse(raw);
  return new Map(procs.map((p) => [p.name, p.pm2_env?.status ?? "stopped"]));
}

export async function remove(name: string): Promise<void> {
  await run(["pm2", "delete", name]);
}

export async function control(name: string, action: "stop" | "start" | "restart") {
  // `pm2 start <name>` reads a dotted name as a script path; restart also starts a stopped app.
  await runOrThrow(["pm2", action === "stop" ? "stop" : "restart", name]);
}

const logFile = (name: string) => `${process.env.PM2_HOME ?? "/root/.pm2"}/logs/${name}.log`;

export async function logs(name: string, lines: number): Promise<string> {
  return (await run(["tail", "-n", String(lines), logFile(name)])).stdout;
}
