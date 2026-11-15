import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "fs";
import { dirname, join, posix } from "path";
import { REPO_PATTERN } from "./contract";
import { config } from "./config";
import { prepare } from "./deploy";
import { toApiError } from "./errors";
import { installHook, repoPath } from "./git";
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

async function prepareFirstPush(repo: string, commit: string): Promise<void> {
  if (state[repo]?.prepared || !existsSync(repoPath(repo))) return;
  // Set first: a failed install must not run again on the next push.
  state = { ...state, [repo]: { ...state[repo], prepared: true } };
  saveState();

  const tree = await run(["git", "-C", repoPath(repo), "ls-tree", "-r", "--name-only", commit]);
  const roots = findApps(tree.ok ? tree.stdout.split("\n").filter(Boolean) : []);
  const install = roots.length === 1 ? state[repo]?.install : undefined;
  for (const root of roots) {
    await prepare(repo, commit, { root, install }).catch((error) =>
      console.error(`first-push install of ${repo}/${root} failed: ${toApiError(error).message}`),
    );
  }
}

let draining = false;

async function drain(): Promise<void> {
  if (draining) return;
  draining = true;
  try {
    for (const file of readdirSync(config.paths.queue)) {
      if (!file.endsWith(".push")) continue;
      const path = join(config.paths.queue, file);
      const content = readFileSync(path, "utf8").slice(0, 65_536);
      rmSync(path, { force: true });
      const push = parsePush(file, content);
      if (push) await prepareFirstPush(push.repo, push.commit);
    }
  } catch (error) {
    console.error(`push queue: ${toApiError(error).message}`);
  } finally {
    draining = false;
  }
}

export function watchPushes(): void {
  for (const name of existsSync(config.paths.repos) ? readdirSync(config.paths.repos) : []) {
    if (name.endsWith(".git")) installHook(name.slice(0, -4));
  }
  // Polled: fs.watch misses the hook's rename now and then.
  setInterval(() => void drain(), 1000);
}
