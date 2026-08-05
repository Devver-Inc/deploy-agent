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

  async createCandidateWorktree(
    branch: string,
    commit: string | undefined,
    repo: string,
    requestId: string,
  ): Promise<string> {
    const candidatePath = this.paths.getCandidateWorktreePath(
      branch,
      repo,
      requestId,
    );
    await this.worktrees.createCandidateWorktree(
      this.getRepoPath(repo),
      candidatePath,
      commit ?? branch,
    );
    return candidatePath;
  }

  async promoteCandidateWorktree(
    branch: string,
    repo: string,
    requestId: string,
  ): Promise<string> {
    const activePath = this.getWorktreePath(branch, repo);
    const candidatePath = this.paths.getCandidateWorktreePath(
      branch,
      repo,
      requestId,
    );
    const backupPath = this.paths.getBackupWorktreePath(
      branch,
      repo,
      requestId,
    );
    await this.worktrees.promoteCandidateWorktree(
      this.getRepoPath(repo),
      activePath,
      candidatePath,
      backupPath,
    );
    return activePath;
  }

  async rollbackPromotion(
    branch: string,
    repo: string,
    requestId: string,
  ): Promise<void> {
    await this.worktrees.rollbackPromotion(
      this.getRepoPath(repo),
      this.getWorktreePath(branch, repo),
      this.paths.getBackupWorktreePath(branch, repo, requestId),
    );
  }

  async discardCandidateWorktree(
    branch: string,
    repo: string,
    requestId: string,
  ): Promise<void> {
    await this.worktrees.removeWorktree(
      this.getRepoPath(repo),
      this.paths.getCandidateWorktreePath(branch, repo, requestId),
    );
  }

  async cleanupBackupWorktree(
    branch: string,
    repo: string,
    requestId: string,
  ): Promise<void> {
    await this.worktrees.removeWorktree(
      this.getRepoPath(repo),
      this.paths.getBackupWorktreePath(branch, repo, requestId),
    );
  }

  async getCommitAtPath(worktreePath: string): Promise<string> {
    return this.worktrees.getCurrentCommit(worktreePath);
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

  private getWorktreePath(branch: string, repo: string): string {
    return this.paths.getWorktreePath(branch, repo);
  }

  getDeploymentId(branch: string, repo: string): string {
    return this.paths.getDeploymentId(branch, repo);
  }
}

export const gitManager = new GitManager();
