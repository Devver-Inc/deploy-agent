import { chmodSync, existsSync, mkdirSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import { config } from "./config";
import { run, runOrThrow } from "./utils/exec";
import { AgentError } from "./errors";

// git always runs against the bare repo (owned by git), never inside a release
// directory: those belong to the deploy user and must not feed root's git config.

export const repoPath = (repo: string) => join(config.paths.repos, `${repo}.git`);
export const releaseDir = (id: string, release: string) =>
  join(config.paths.deployments, id, release);

// Runs as `git` during the push: no secret, no network, only a file in the queue.
const HOOK = `#!/bin/sh
name=$(basename "$(pwd)" .git)
tmp="${config.paths.queue}/.$name.$$"
cat > "$tmp" && mv "$tmp" "${config.paths.queue}/$name.$$.push"
exit 0
`;

export function installHook(repo: string): void {
  const hook = join(repoPath(repo), "hooks", "post-receive");
  writeFileSync(hook, HOOK);
  chmodSync(hook, 0o755);
}

export async function createRepo(repo: string): Promise<void> {
  const path = repoPath(repo);
  if (existsSync(path)) return;
  await runOrThrow(["git", "init", "--bare", "--quiet", path]);
  await runOrThrow(["chown", "-R", "git:git", path]);
  installHook(repo);
}

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

export async function removeRelease(repo: string, id: string, release: string) {
  rmSync(releaseDir(id, release), { recursive: true, force: true });
  if (existsSync(repoPath(repo))) {
    await run(["git", "-C", repoPath(repo), "worktree", "prune"]);
  }
}

// Writes into the bare repo run as its owner, so later pushes can still rewrite it.
const asOwner = (repo: string, args: string[]) => run(["git", "-C", repoPath(repo), ...args], { user: "git" });

/** Keeps a deployed commit from being garbage-collected after its branch moves on. */
export async function pinCommit(repo: string, id: string, commit: string): Promise<void> {
  await asOwner(repo, ["update-ref", `refs/devver/deployments/${id}`, commit]);
}

export async function unpinCommit(repo: string, id: string): Promise<void> {
  if (existsSync(repoPath(repo))) await asOwner(repo, ["update-ref", "-d", `refs/devver/deployments/${id}`]);
}

/** The nearest deployed commit on `commit`'s first-parent history, excluding `commit` itself. */
export function nearestDeployed(history: string[], deployed: Map<string, string>): string | null {
  for (const ancestor of history.slice(1)) {
    const id = deployed.get(ancestor);
    if (id) return id;
  }
  return null;
}

export async function firstParentHistory(repo: string, commit: string): Promise<string[]> {
  await resolveCommit(repo, commit);
  const result = await run(["git", "-C", repoPath(repo), "rev-list", "--first-parent", commit]);
  if (!result.ok) throw new AgentError(422, "GIT_FAILED", "Could not read the commit history.");
  return result.stdout.split("\n").filter(Boolean);
}

export async function mergeCommits(repo: string, first: string, second: string): Promise<string> {
  await resolveCommit(repo, first);
  await resolveCommit(repo, second);
  if (!(await asOwner(repo, ["merge-base", first, second])).ok) {
    throw new AgentError(409, "UNRELATED_HISTORIES", "The two revisions share no history.");
  }
  const tree = await asOwner(repo, ["merge-tree", "--write-tree", "--name-only", first, second]);
  if (!tree.ok) {
    const conflicts = tree.stdout.split("\n\n")[0]!.split("\n").slice(1).join("\n");
    throw new AgentError(409, "MERGE_CONFLICT", "Merge conflicts prevent combining these revisions.", conflicts);
  }
  const commit = await asOwner(repo, [
    "-c", "user.name=Devver", "-c", "user.email=devver@localhost",
    "commit-tree", tree.stdout.trim(), "-p", first, "-p", second, "-m", "Merge Devver deployments",
  ]);
  if (!commit.ok) throw new AgentError(422, "GIT_FAILED", "Git could not write the merge commit.", commit.stderr);
  return commit.stdout.trim();
}
