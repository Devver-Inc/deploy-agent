import { createHash } from "crypto";
import { existsSync, readFileSync, rmSync } from "fs";
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
// The env only lives in memory: the backend resends it on every PUT and at boot.
const envs = new Map<string, Record<string, string>>();

const LOCKFILES = [
  "package.json", "bun.lock", "bun.lockb", "package-lock.json", "yarn.lock", "pnpm-lock.yaml",
  "requirements.txt", "pyproject.toml", "poetry.lock", "Gemfile", "Gemfile.lock", "go.mod", "go.sum",
];
const BUILD_CACHES = [".next/cache", "node_modules/.vite"];

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

function sameDeployment(r: Release, spec: Deployment, commit: string): boolean {
  return (
    r.repo === spec.repo && r.commit === commit && r.host === spec.host &&
    JSON.stringify(r.service) === JSON.stringify(spec.service)
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

/** Hardlink copy: same volume, no extra space, instant. */
async function linkCopy(from: string, to: string): Promise<void> {
  if (!existsSync(from) || existsSync(to)) return;
  await run(["mkdir", "-p", dirname(to)], { user: "deploy" });
  await run(["cp", "-al", from, to], { user: "deploy" });
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

/**
 * Blue/green: every release gets its own directory and port; the old one keeps
 * serving until the new one answers, then nginx swaps. Nothing is ever moved,
 * so a failure only has to delete what it created.
 */
async function deployLocked(id: string, spec: Deployment, emit: Emit): Promise<DeploymentStatus> {
  envs.set(id, spec.env ?? {});
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
  try {
    let servicePath: string;
    try {
      servicePath = resolvePathWithin(dir, spec.service.root);
    } catch {
      throw new AgentError(400, "INVALID_ROOT", "service.root must stay inside the repository.");
    }
    const runtime = resolveRuntime(servicePath);
    const service = { ...spec.service };
    // A Node app sent without build/start runs its `dev` script (HMR, no production build).
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
    const previous = current && existsSync(releaseDir(id, current.release)) ? servicePathOf(current) : undefined;
    // ponytail: only node_modules is reused; .venv/.bundle hold absolute paths to their release.
    if (previous && current?.lockHash === hash && existsSync(join(previous, "node_modules"))) {
      await linkCopy(join(previous, "node_modules"), join(servicePath, "node_modules"));
    } else {
      for (const command of runtime?.beforeInstallCommands ?? []) {
        await userStep("INSTALL_FAILED", command, servicePath, env("install"));
      }
      if (service.install) await userStep("INSTALL_FAILED", service.install, servicePath, env("install"));
    }
    phase("install");

    if (service.build) {
      for (const cache of BUILD_CACHES) {
        if (previous) await linkCopy(join(previous, cache), join(servicePath, cache));
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
      release, port, lockHash: hash, startedAt: new Date().toISOString(),
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
  }

  if (current) {
    await pm2.remove(current.release);
    await removeRelease(current.repo, id, current.release);
  }
  return statusOf(store.get(id)!, await pm2.list());
}

export function remove(id: string): Promise<void> {
  return lock.run(id, async () => {
    const current = store.get(id);
    if (!current) return;
    store.delete(id);
    envs.delete(id);
    await syncRoutes();
    await pm2.remove(current.release);
    await removeRelease(current.repo, id, current.release);
    rmSync(join(config.paths.deployments, id), { recursive: true, force: true });
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

/** post-receive: redeploy what follows the pushed branch. */
export async function onPush(repo: string, ref: string): Promise<void> {
  for (const r of store.all().filter((r) => r.repo === repo && r.ref === ref)) {
    const env = envs.get(r.id);
    if (!env) continue; // agent restarted; the boot reconcile resends it
    await deploy(r.id, { repo, ref, host: r.host, service: r.service, env }).catch((error) =>
      console.error(`push redeploy of ${r.id} failed: ${toApiError(error).message}`),
    );
  }
}

/** Boot: make the local state match the backend's (replaces the restore endpoint). */
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
