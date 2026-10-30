import { createHash } from "crypto";
import { existsSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "fs";
import { createServer, type AddressInfo } from "net";
import { dirname, join } from "path";
import type { Deployment, DeploymentStatus, Phase } from "./contract";
import { config } from "./config";
import { AgentError, toApiError } from "./errors";
import { addRelease, createRepo, deleteRepo, releaseDir, removeRelease, resolveCommit } from "./git";
import { syncRoutes } from "./nginx";
import * as pm2 from "./pm2";
import { resolveRuntime } from "./runtime";
import { store, type Release } from "./store";
import { KeyedAsyncMutex } from "./utils/async-mutex";
import { run, runUserCommand } from "./utils/exec";
import { pollUntil } from "./utils/poll-until";
import { resolvePathWithin } from "./utils/validation";

type Emit = (phase: Phase, durationMs: number) => void;

const lock = new KeyedAsyncMutex();

const LOCKFILES = [
  "package.json", "bun.lock", "bun.lockb", "package-lock.json", "yarn.lock", "pnpm-lock.yaml",
  "requirements.txt", "pyproject.toml", "poetry.lock", "Gemfile", "Gemfile.lock", "go.mod", "go.sum",
];
const BUILD_CACHES = [".next/cache", "node_modules/.vite", "node_modules/.cache"];

export function lockHash(servicePath: string, root = "."): string {
  const hash = createHash("sha256").update(root);
  for (const file of LOCKFILES) {
    const path = join(servicePath, file);
    if (existsSync(path)) hash.update(file).update(readFileSync(path));
  }
  return hash.digest("hex");
}

const servicePathOf = (r: Release) =>
  resolvePathWithin(releaseDir(r.id, r.release), r.service.root);

// Only a hash is stored: an env change must redeploy, but its values never touch disk.
export function envHash(env: Record<string, string> = {}): string {
  const sorted = Object.entries(env).sort(([a], [b]) => a.localeCompare(b));
  return createHash("sha256").update(JSON.stringify(sorted)).digest("hex");
}

function sameDeployment(r: Release, spec: Deployment, commit: string): boolean {
  return (
    r.repo === spec.repo && r.commit === commit && r.host === spec.host &&
    JSON.stringify(r.service) === JSON.stringify(spec.service) &&
    r.envHash === envHash(spec.env)
  );
}

function statusOf(r: Release, procs: Map<string, pm2.Pm2Status>): DeploymentStatus {
  const proc = procs.get(r.release);
  return {
    id: r.id, repo: r.repo, ref: r.ref, commit: r.commit, host: r.host, startedAt: r.startedAt,
    status: proc === "online" ? "running" : proc === "stopped" ? "stopped" : "failed",
  };
}

async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address() as AddressInfo;
      server.close(() => resolve(port));
    });
  });
}

async function cpInto(flags: string, from: string, to: string): Promise<void> {
  if (!existsSync(from) || existsSync(to)) return;
  await run(["mkdir", "-p", dirname(to)], { user: "deploy" });
  await run(["cp", flags, from, to], { user: "deploy" });
}

const sharedDir = (kind: "node_modules" | "venvs", hash: string) =>
  join(config.paths.caches, kind, hash);

// Shared by every branch with the same lockfile hash and never modified, so a
// build must not write into it: these build caches stay per release.
const NODE_MODULES_CACHES = [".vite", ".cache"];

async function sharedNodeModules(servicePath: string, hash: string, install: () => Promise<void>) {
  const shared = sharedDir("node_modules", hash);
  if (existsSync(shared)) return cpInto("-al", shared, join(servicePath, "node_modules"));

  await install();
  const tmp = `${shared}.tmp-${Date.now().toString(36)}`;
  await cpInto("-al", join(servicePath, "node_modules"), tmp);
  for (const cache of NODE_MODULES_CACHES) rmSync(join(tmp, cache), { recursive: true, force: true });
  try {
    renameSync(tmp, shared);
  } catch {
    // Another deploy with the same hash published it first.
    rmSync(tmp, { recursive: true, force: true });
  }
}

// A virtualenv stores absolute paths, so it is built in place (no temp + rename)
// under a per-hash lock, and `.ready` marks it complete.
const venvLock = new KeyedAsyncMutex();

async function sharedVenv(servicePath: string, hash: string, install: () => Promise<void>) {
  const shared = sharedDir("venvs", hash);
  const link = async () => {
    rmSync(join(servicePath, ".venv"), { recursive: true, force: true });
    await run(["ln", "-s", shared, join(servicePath, ".venv")], { user: "deploy" });
  };
  await venvLock.run(hash, async () => {
    if (existsSync(join(shared, ".ready"))) return link();
    rmSync(shared, { recursive: true, force: true });
    await run(["mkdir", "-p", dirname(shared)], { user: "deploy" });
    const created = await run(["python", "-m", "venv", shared], { user: "deploy" });
    if (!created.ok) {
      throw new AgentError(422, "INSTALL_FAILED", "Could not create the Python virtualenv.", created.stderr);
    }
    await link();
    try {
      await install();
    } catch (error) {
      rmSync(shared, { recursive: true, force: true });
      throw error;
    }
    writeFileSync(join(shared, ".ready"), "");
  });
}

const inFlight: string[] = [];

export function pruneShared(keep: Set<string>, root = config.paths.caches): void {
  for (const kind of ["node_modules", "venvs"]) {
    const dir = join(root, kind);
    if (!existsSync(dir)) continue;
    for (const name of readdirSync(dir)) {
      // Temp folders belong to a deploy that is publishing right now.
      if (/^[0-9a-f]{64}$/.test(name) && !keep.has(name)) {
        rmSync(join(dir, name), { recursive: true, force: true });
      }
    }
  }
}

function pruneUnused(): void {
  pruneShared(new Set([...store.all().map((r) => r.lockHash ?? ""), ...inFlight]));
}

async function userStep(code: string, command: string, cwd: string, env: Record<string, string>) {
  const result = await runUserCommand(command, cwd, env);
  if (!result.ok) {
    const logs = `$ ${command}\n${result.stdout}${result.stderr}`.slice(-20_000);
    throw new AgentError(422, code, `'${command}' exited with code ${result.code}.`, logs);
  }
}

async function waitHealthy(name: string, port: number, timeoutMs = 60_000): Promise<void> {
  try {
    await pollUntil(
      async () => {
        if ((await pm2.list()).get(name) === "errored") throw new Error("The process crashed.");
        const response = await fetch(`http://127.0.0.1:${port}/`, {
          redirect: "manual",
          signal: AbortSignal.timeout(1000),
        }).catch(() => undefined);
        return !!response && response.status < 500;
      },
      timeoutMs,
      `The app did not answer on port ${port} within ${timeoutMs / 1000}s. It must listen on process.env.PORT.`,
      250,
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new AgentError(422, "START_FAILED", message, await pm2.logs(name, 50));
  }
}

export function deploy(id: string, spec: Deployment, emit: Emit = () => {}) {
  return lock.run(id, () => deployLocked(id, spec, emit));
}

async function deployLocked(id: string, spec: Deployment, emit: Emit): Promise<DeploymentStatus> {
  await createRepo(spec.repo);
  const commit = await resolveCommit(spec.repo, spec.ref);
  const current = store.get(id);
  if (current && sameDeployment(current, spec, commit)) {
    const procs = await pm2.list();
    if (procs.get(current.release) === "online") return statusOf(current, procs);
  }

  let clock = Date.now();
  const phase = (p: Phase) => {
    emit(p, Date.now() - clock);
    clock = Date.now();
  };

  const release = `${id}.${Date.now().toString(36)}`;
  const dir = await addRelease(spec.repo, id, release, commit);
  let pinned: string | undefined;
  try {
    let servicePath: string;
    try {
      servicePath = resolvePathWithin(dir, spec.service.root);
    } catch {
      throw new AgentError(400, "INVALID_ROOT", "service.root must stay inside the repository.");
    }
    const runtime = resolveRuntime(servicePath);
    const service = { ...spec.service };
    const dev = !!runtime?.devCommand && !service.build && !service.start;
    if (dev) service.start = runtime!.devCommand;
    service.install ??= runtime?.installCommand;
    service.start ??= runtime?.startCommand;
    if (!service.start) {
      throw new AgentError(
        422,
        "NO_START_COMMAND",
        `${runtime ? `Detected '${runtime.id}', but no` : "No"} start command. Send service.start or add a Procfile 'web:' line.`,
      );
    }
    phase("checkout");

    const env = (stage: "install" | "build" | "run" | "dev") => ({
      ...runtime?.environment(servicePath, stage),
      ...spec.env,
    });
    const hash = lockHash(servicePath, spec.service.root);
    pinned = hash;
    inFlight.push(hash);
    const install = async () => {
      if (service.install) await userStep("INSTALL_FAILED", service.install, servicePath, env("install"));
    };
    // ponytail: Ruby (.bundle) reinstalls every release; Go's module cache is already global.
    if (runtime?.id.startsWith("node/")) await sharedNodeModules(servicePath, hash, install);
    else if (runtime?.id.startsWith("python/")) await sharedVenv(servicePath, hash, install);
    else await install();
    phase("install");

    const previous = current && existsSync(releaseDir(id, current.release)) ? servicePathOf(current) : undefined;
    if (service.build) {
      for (const cache of BUILD_CACHES) {
        if (previous) await cpInto("-a", join(previous, cache), join(servicePath, cache));
      }
      await userStep("BUILD_FAILED", service.build, servicePath, env("build"));
    }
    phase("build");

    const port = await freePort();
    const command = runtime?.prepareStart(service.start, port, servicePath) ?? service.start;
    await pm2.start(release, command, servicePath, {
      ...env(dev ? "dev" : "run"),
      PORT: String(port),
      HOST: "0.0.0.0",
      // Vite rejects unknown Host headers (allowedHosts) unless told about the preview host.
      __VITE_ADDITIONAL_SERVER_ALLOWED_HOSTS: spec.host,
    });
    await waitHealthy(release, port);
    phase("start");

    store.set({
      id, repo: spec.repo, ref: spec.ref, commit, host: spec.host, service: spec.service,
      release, port, lockHash: hash, envHash: envHash(spec.env), startedAt: new Date().toISOString(),
    });
    try {
      await syncRoutes({ host: spec.host, port });
    } catch (error) {
      if (current) store.set(current);
      else store.delete(id);
      await syncRoutes().catch(() => {});
      throw error;
    }
    phase("route");
  } catch (error) {
    await pm2.remove(release);
    await removeRelease(spec.repo, id, release);
    throw error;
  } finally {
    if (pinned) inFlight.splice(inFlight.indexOf(pinned), 1);
  }

  if (current) {
    await pm2.remove(current.release);
    await removeRelease(current.repo, id, current.release);
  }
  pruneUnused();
  return statusOf(store.get(id)!, await pm2.list());
}

export function remove(id: string): Promise<void> {
  return lock.run(id, async () => {
    const current = store.get(id);
    if (!current) return;
    store.delete(id);
    await syncRoutes();
    await pm2.remove(current.release);
    await removeRelease(current.repo, id, current.release);
    rmSync(join(config.paths.deployments, id), { recursive: true, force: true });
    pruneUnused();
  });
}

export async function list(): Promise<DeploymentStatus[]> {
  const procs = await pm2.list();
  return store.all().map((r) => statusOf(r, procs));
}

export function find(id: string): Release {
  const release = store.get(id);
  if (!release) throw new AgentError(404, "DEPLOYMENT_NOT_FOUND", `Deployment '${id}' does not exist.`);
  return release;
}

export async function removeRepo(repo: string): Promise<void> {
  for (const r of store.all().filter((r) => r.repo === repo)) await remove(r.id);
  deleteRepo(repo);
}

export async function reconcile(): Promise<void> {
  const { backendUrl, projectId, secret } = config;
  if (!backendUrl || !projectId || !secret) return;
  let desired: ({ id: string } & Deployment)[] | undefined;
  for (let attempt = 0; attempt < 30 && !desired; attempt++) {
    const response = await fetch(`${backendUrl}/internal/projects/${projectId}/deployments`, {
      headers: { "x-devver-secret": secret },
    }).catch(() => undefined);
    if (response?.ok) desired = (await response.json()) as typeof desired;
    else await Bun.sleep(10_000);
  }
  if (!desired) return console.error("reconcile: backend unreachable, keeping local state");

  const ids = new Set(desired.map((d) => d.id));
  for (const r of store.all().filter((r) => !ids.has(r.id))) await remove(r.id);
  for (const { id, ...spec } of desired) {
    await deploy(id, spec).catch((error) =>
      console.error(`reconcile of ${id} failed: ${toApiError(error).message}`),
    );
  }
}
