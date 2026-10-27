import { repoManager } from "./repo-manager";
import { GitPaths } from "./git/git-paths";
import { GitWorktreeOperations } from "./git/git-worktree-operations";
import type { ServiceName } from "../types";

export class GitManager {
  private paths = new GitPaths();
  private worktrees = new GitWorktreeOperations();

  private getRepoPath(repo: string): string {
    return repoManager.getRepoPath(repo);
  }

  async createCandidateWorktree(
    branch: string,
    commit: string | undefined,
    repo: string,
    service: ServiceName,
    requestId: string,
  ): Promise<string> {
    const candidatePath = this.paths.getCandidateWorktreePath(
      branch,
      repo,
      service,
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
    service: ServiceName,
    requestId: string,
  ): Promise<string> {
    const activePath = this.paths.getWorktreePath(branch, repo, service);
    await this.worktrees.promoteCandidateWorktree(
      this.getRepoPath(repo),
      activePath,
      this.paths.getCandidateWorktreePath(branch, repo, service, requestId),
      this.paths.getBackupWorktreePath(branch, repo, service, requestId),
    );
    return activePath;
  }

  async rollbackPromotion(
    branch: string,
    repo: string,
    service: ServiceName,
    requestId: string,
  ): Promise<void> {
    await this.worktrees.rollbackPromotion(
      this.getRepoPath(repo),
      this.paths.getWorktreePath(branch, repo, service),
      this.paths.getBackupWorktreePath(branch, repo, service, requestId),
    );
  }

  async discardCandidateWorktree(
    branch: string,
    repo: string,
    service: ServiceName,
    requestId: string,
  ): Promise<void> {
    await this.worktrees.removeWorktree(
      this.getRepoPath(repo),
      this.paths.getCandidateWorktreePath(branch, repo, service, requestId),
    );
  }

  async cleanupBackupWorktree(
    branch: string,
    repo: string,
    service: ServiceName,
    requestId: string,
  ): Promise<void> {
    await this.worktrees.removeWorktree(
      this.getRepoPath(repo),
      this.paths.getBackupWorktreePath(branch, repo, service, requestId),
    );
  }

  async getCommitAtPath(worktreePath: string): Promise<string> {
    return this.worktrees.getCurrentCommit(worktreePath);
  }

  async removeWorktree(
    branch: string,
    repo: string,
    service: ServiceName,
  ): Promise<void> {
    await this.worktrees.removeWorktree(
      this.getRepoPath(repo),
      this.paths.getWorktreePath(branch, repo, service),
    );
  }

  async listWorktrees(repo: string, service: ServiceName): Promise<string[]> {
    return this.worktrees.listWorktrees(
      this.getRepoPath(repo),
      this.paths.getDeploymentsPath(repo, service),
    );
  }

  async getCurrentCommit(
    branch: string,
    repo: string,
    service: ServiceName,
  ): Promise<string> {
    return this.worktrees.getCurrentCommit(
      this.paths.getWorktreePath(branch, repo, service),
    );
  }

  getDeploymentId(branch: string, repo: string, service: ServiceName): string {
    return this.paths.getDeploymentId(branch, repo, service);
  }
}

export const gitManager = new GitManager();
