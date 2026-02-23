import { repoManager } from "./repo-manager";
import { GitPaths } from "./git/git-paths";
import { GitWorktreeOperations } from "./git/git-worktree-operations";

export class GitManager {
  private paths = new GitPaths();
  private worktrees = new GitWorktreeOperations();

  private getRepoPath(repo: string): string {
    return repoManager.getRepoPath(repo);
  }

  private getDeploymentsPath(repo: string): string {
    return this.paths.getDeploymentsPath(repo);
  }

  worktreeExists(branch: string, repo: string): boolean {
    return this.worktrees.worktreeExists(this.getWorktreePath(branch, repo));
  }

  async createWorktree(
    branch: string,
    commit: string | undefined,
    repo: string,
  ): Promise<void> {
    const repoPath = this.getRepoPath(repo);
    const deploymentsPath = this.getDeploymentsPath(repo);
    const worktreePath = this.getWorktreePath(branch, repo);

    await this.worktrees.createWorktree(
      repoPath,
      deploymentsPath,
      worktreePath,
      branch,
      commit,
    );
  }

  async updateWorktree(
    branch: string,
    commit: string | undefined,
    repo: string,
  ): Promise<void> {
    const repoPath = this.getRepoPath(repo);
    const worktreePath = this.getWorktreePath(branch, repo);
    await this.worktrees.updateWorktree(repoPath, worktreePath, branch, commit);
  }

  async removeWorktree(branch: string, repo: string): Promise<void> {
    const repoPath = this.getRepoPath(repo);
    const worktreePath = this.getWorktreePath(branch, repo);
    await this.worktrees.removeWorktree(repoPath, worktreePath);
  }

  async listWorktrees(repo: string): Promise<string[]> {
    const repoPath = this.getRepoPath(repo);
    const deploymentsPath = this.getDeploymentsPath(repo);
    return this.worktrees.listWorktrees(repoPath, deploymentsPath);
  }

  async getCurrentCommit(branch: string, repo: string): Promise<string> {
    const worktreePath = this.getWorktreePath(branch, repo);
    return this.worktrees.getCurrentCommit(worktreePath);
  }

  getWorktreePath(branch: string, repo: string): string {
    return this.paths.getWorktreePath(branch, repo);
  }

  getDeploymentId(branch: string, repo: string): string {
    return this.paths.getDeploymentId(branch, repo);
  }
}

export const gitManager = new GitManager();
