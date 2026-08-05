import { safeBranch } from "../../utils/branch";
import { config } from "../../config";

export class GitPaths {
  getDeploymentsPath(repo: string): string {
    return `${config.paths.deployments}/${repo}`;
  }

  getWorktreePath(branch: string, repo: string): string {
    return `${this.getDeploymentsPath(repo)}/${branch}`;
  }

  getCandidateWorktreePath(
    branch: string,
    repo: string,
    requestId: string,
  ): string {
    return `${this.getDeploymentsPath(repo)}/.releases/${safeBranch(branch)}-${requestId}`;
  }

  getBackupWorktreePath(
    branch: string,
    repo: string,
    requestId: string,
  ): string {
    return `${this.getDeploymentsPath(repo)}/.releases/${safeBranch(branch)}-previous-${requestId}`;
  }

  getDeploymentId(branch: string, repo: string): string {
    return `${repo}-${safeBranch(branch)}`;
  }
}
