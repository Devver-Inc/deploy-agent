import { safeBranch } from "../../utils/branch";

const DEPLOYMENTS_BASE = "/app/deployments";

export class GitPaths {
  getDeploymentsPath(repo: string): string {
    return `${DEPLOYMENTS_BASE}/${repo}`;
  }

  getWorktreePath(branch: string, repo: string): string {
    return `${this.getDeploymentsPath(repo)}/${branch}`;
  }

  getDeploymentId(branch: string, repo: string): string {
    return `${repo}-${safeBranch(branch)}`;
  }
}
