import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, watch, writeFileSync } from "fs";
import { dirname, join, posix } from "path";
import { REPO_PATTERN } from "./contract";
import { config } from "./config";
import { prepare } from "./deploy";
import { toApiError } from "./errors";
import { installHook, repoPath } from "./git";
import { AsyncMutex } from "./utils/async-mutex";
import { run } from "./utils/exec";

interface RepoState {
  install?: string;
  prepared?: boolean;
}

function loadState(): Record<string, RepoState> {
  try {
    return JSON.parse(readFileSync(config.paths.repoState, "utf8"));
  } catch {
    return {};
  }
}

let state = loadState();

function saveState(): void {
  mkdirSync(dirname(config.paths.repoState), { recursive: true });
  const tmp = `${config.paths.repoState}.tmp`;
  writeFileSync(tmp, JSON.stringify(state, null, 2), { mode: 0o600 });
  renameSync(tmp, config.paths.repoState);
}

export function setRepoConfig(repo: string, install: string | undefined): void {
  state = { ...state, [repo]: { ...state[repo], install } };
  saveState();
}

export function forgetRepo(repo: string): void {
  const { [repo]: _, ...rest } = state;
  state = rest;
  saveState();
}

const SHA = /^([0-9a-f]{40}|[0-9a-f]{64})$/;
const BRANCH = /^refs\/heads\/[A-Za-z0-9._/-]{1,200}$/;

/** The first branch the push created or updated; the file is written by the git user, so untrusted. */
export function parsePush(file: string, content: string): { repo: string; commit: string } | undefined {
  const repo = file.match(/^(.+)\.\d+\.push$/)?.[1];
  if (!repo || !new RegExp(REPO_PATTERN).test(repo)) return undefined;
  for (const line of content.split("\n")) {
    const [, next, ref] = line.trim().split(" ");
    if (next && ref && SHA.test(next) && !/^0+$/.test(next) && BRANCH.test(ref)) return { repo, commit: next };
  }
  return undefined;
}

const MANIFESTS = ["package.json", "requirements.txt", "pyproject.toml", "go.mod", "Gemfile"];
const ROOT_LOCKS = ["package-lock.json", "pnpm-lock.yaml", "bun.lock", "bun.lockb", "yarn.lock", "poetry.lock", "go.sum", "Gemfile.lock"];
const SKIP = /(^|\/)(node_modules|vendor|\.git|\.venv|dist|build)(\/|$)/;
const MAX_APPS = 20;

/**
 * A lockfile at the root means one install covers everything (workspaces too);
 * otherwise every folder with a manifest is an app of its own.
 */
export function findApps(files: string[]): string[] {
  if (files.some((f) => ROOT_LOCKS.includes(f))) return ["."];
  const roots = new Set<string>();
  for (const file of files) {
    if (SKIP.test(file) || !MANIFESTS.includes(posix.basename(file))) continue;
    const dir = posix.dirname(file);
    if (dir.split("/").length <= 3) roots.add(dir);
  }
  return roots.size ? [...roots].sort().slice(0, MAX_APPS) : ["."];
}

interface AppReport {
  root: string;
  status: "running" | "done" | "failed";
  durationMs?: number;
  runtime?: string | null;
  error?: ReturnType<typeof toApiError>;
}

async function report(repo: string, body: object): Promise<void> {
  const { backendUrl, projectId, secret } = config;
  if (!backendUrl || !projectId || !secret) return;
  for (let attempt = 1; attempt <= 3; attempt++) {
    const response = await fetch(`${backendUrl}/internal/projects/${projectId}/repos/${repo}/prepare`, {
      method: "POST",
      headers: { "x-devver-secret": secret, "content-type": "application/json" },
      body: JSON.stringify(body),
    }).catch(() => undefined);
    if (response?.ok) return;
    await Bun.sleep(2000 * attempt);
  }
  console.error(`prepare report for ${repo} could not reach the backend`);
}

async function prepareFirstPush(repo: string, commit: string): Promise<void> {
  if (state[repo]?.prepared || !existsSync(repoPath(repo))) return;
  // Set first: a failed install must not run again on the next push.
  state = { ...state, [repo]: { ...state[repo], prepared: true } };
  saveState();

  const tree = await run(["git", "-C", repoPath(repo), "ls-tree", "-r", "--name-only", commit]);
  const roots = findApps(tree.ok ? tree.stdout.split("\n").filter(Boolean) : []);
  const install = roots.length === 1 ? state[repo]?.install : undefined;
  const startedAt = new Date().toISOString();
  const apps: AppReport[] = roots.map((root) => ({ root, status: "running" }));
  await report(repo, { status: "running", commit, startedAt, apps });

  for (const app of apps) {
    const started = Date.now();
    try {
      const result = await prepare(repo, commit, { root: app.root, install });
      Object.assign(app, { status: "done", runtime: result.runtime });
    } catch (error) {
      Object.assign(app, { status: "failed", error: toApiError(error) });
    }
    app.durationMs = Date.now() - started;
  }
  const failed = apps.some((a) => a.status === "failed");
  await report(repo, { status: failed ? "failed" : "done", commit, startedAt, finishedAt: new Date().toISOString(), apps });
}

const queueLock = new AsyncMutex();

function drain(): Promise<void> {
  return queueLock.run(async () => {
    for (const file of readdirSync(config.paths.queue)) {
      if (!file.endsWith(".push")) continue;
      const path = join(config.paths.queue, file);
      const content = readFileSync(path, "utf8").slice(0, 65_536);
      rmSync(path, { force: true });
      const push = parsePush(file, content);
      if (push) {
        await prepareFirstPush(push.repo, push.commit).catch((error) =>
          console.error(`first-push install of ${push.repo} failed: ${toApiError(error).message}`),
        );
      }
    }
  });
}

export function watchPushes(): void {
  for (const name of existsSync(config.paths.repos) ? readdirSync(config.paths.repos) : []) {
    if (name.endsWith(".git")) installHook(name.slice(0, -4));
  }
  watch(config.paths.queue, () => void drain());
  void drain();
}
