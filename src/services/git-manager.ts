import { existsSync } from "fs";
import { exec, execOrThrow } from "../utils/exec";
import { ensureDir } from "../utils/fs";
import { repoManager } from "./repo-manager";

const DEPLOYMENTS_BASE = "/app/deployments";

export class GitManager {
  private getRepoPath(repo: string): string {
    return repoManager.getRepoPath(repo);
  }

  private getDeploymentsPath(repo: string): string {
    return `${DEPLOYMENTS_BASE}/${repo}`;
  }

  worktreeExists(branch: string, repo: string): boolean {
    return existsSync(this.getWorktreePath(branch, repo));
  }

  async createWorktree(branch: string, commit: string | undefined, repo: string): Promise<void> {
    const repoPath = this.getRepoPath(repo);
    const deploymentsPath = this.getDeploymentsPath(repo);
    const worktreePath = `${deploymentsPath}/${branch}`;

    ensureDir(deploymentsPath);
    await execOrThrow(`git worktree add "${worktreePath}" ${commit ?? branch}`, repoPath);
  }

  async updateWorktree(branch: string, commit: string | undefined, repo: string): Promise<void> {
    const repoPath = this.getRepoPath(repo);
    const worktreePath = this.getWorktreePath(branch, repo);
    const latestCommit = commit ?? (await execOrThrow(`git rev-parse ${branch}`, repoPath)).trim();
    await execOrThrow(`git reset --hard ${latestCommit}`, worktreePath);
    await execOrThrow("git clean -fd", worktreePath);
  }

  async removeWorktree(branch: string, repo: string): Promise<void> {
    const repoPath = this.getRepoPath(repo);
    const worktreePath = this.getWorktreePath(branch, repo);
    if (!existsSync(worktreePath)) return;
    await execOrThrow(`git worktree remove "${worktreePath}" --force`, repoPath);
  }

  async listWorktrees(repo: string): Promise<string[]> {
    const repoPath = this.getRepoPath(repo);
    const deploymentsPath = this.getDeploymentsPath(repo);
    const result = await exec("git worktree list --porcelain", repoPath);
    if (!result.success) return [];

    const worktrees: string[] = [];
    for (const line of result.stdout.split("\n")) {
      if (line.startsWith("worktree ") && line.includes(deploymentsPath)) {
        const path = line.replace("worktree ", "");
        const branch = path.split(deploymentsPath + "/")[1];
        if (branch) worktrees.push(branch);
      }
    }
    return worktrees;
  }

  async getCurrentCommit(branch: string, repo: string): Promise<string> {
    const worktreePath = this.getWorktreePath(branch, repo);
    return (await execOrThrow("git rev-parse HEAD", worktreePath)).trim();
  }

  getWorktreePath(branch: string, repo: string): string {
    return `${this.getDeploymentsPath(repo)}/${branch}`;
  }

  getDeploymentId(branch: string, repo: string): string {
    return `${repo}-${branch.replace(/\//g, "-").toLowerCase()}`;
  }
}

export const gitManager = new GitManager();
