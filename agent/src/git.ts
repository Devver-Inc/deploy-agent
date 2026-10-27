import { existsSync, mkdirSync, rmSync } from "fs";
import { join } from "path";
import { config } from "./config";
import { run, runOrThrow } from "./utils/exec";
import { AgentError } from "./errors";

// git always runs against the bare repo (owned by git), never inside a release
// directory: those belong to the deploy user and must not feed root's git config.

export const repoPath = (repo: string) => join(config.paths.repos, `${repo}.git`);
export const releaseDir = (id: string, release: string) =>
  join(config.paths.deployments, id, release);

/** Idempotent. */
export async function createRepo(repo: string): Promise<void> {
  const path = repoPath(repo);
  if (existsSync(path)) return;
  await runOrThrow(["git", "init", "--bare", "--quiet", path]);
  await runOrThrow(["chown", "-R", "git:git", path]);
  await installPushHook(path);
}

export function deleteRepo(repo: string): void {
  rmSync(repoPath(repo), { recursive: true, force: true });
}

/** Branch name or commit → full commit sha. */
export async function resolveCommit(repo: string, ref: string): Promise<string> {
  if (!existsSync(repoPath(repo))) {
    throw new AgentError(404, "REPO_NOT_FOUND", `Repo '${repo}' does not exist.`);
  }
  for (const candidate of [`refs/heads/${ref}`, ref]) {
    const result = await run(
      ["git", "-C", repoPath(repo), "rev-parse", "--verify", "--quiet", `${candidate}^{commit}`],
    );
    if (result.ok) return result.stdout.trim();
  }
  throw new AgentError(404, "REF_NOT_FOUND", `'${ref}' was not pushed to '${repo}'.`);
}

export async function addRelease(repo: string, id: string, release: string, commit: string) {
  const dir = releaseDir(id, release);
  mkdirSync(join(config.paths.deployments, id), { recursive: true });
  await runOrThrow(["git", "-C", repoPath(repo), "worktree", "add", "--detach", "--quiet", dir, commit]);
  await runOrThrow(["chown", "-R", "deploy:deploy", dir]);
  return dir;
}

/** Releases are never moved: they are only created and deleted. */
export async function removeRelease(repo: string, id: string, release: string) {
  rmSync(releaseDir(id, release), { recursive: true, force: true });
  if (existsSync(repoPath(repo))) {
    await run(["git", "-C", repoPath(repo), "worktree", "prune"]);
  }
}

// Redeploys the deployments that follow the pushed branch. Runs as the git user;
// the agent route is local-only and re-reads the desired state itself.
async function installPushHook(path: string): Promise<void> {
  const hook = join(path, "hooks", "post-receive");
  await Bun.write(
    hook,
    `#!/bin/sh
repo=$(basename "$PWD" .git)
while read -r _old _new ref; do
  case "$ref" in refs/heads/*)
    curl -fsS -X POST "http://127.0.0.1:${config.port}/hooks/push" \\
      -H 'content-type: application/json' \\
      -d "{\\"repo\\":\\"$repo\\",\\"ref\\":\\"\${ref#refs/heads/}\\"}" >/dev/null || true
  esac
done
`,
  );
  await runOrThrow(["chmod", "755", hook]);
  await runOrThrow(["chown", "git:git", hook]);
}
