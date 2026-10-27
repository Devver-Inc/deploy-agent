import { safeBranch } from "../../utils/branch";
import { config } from "../../config";
import type { ServiceName } from "../../types";

// Repo names have no dots, so `<repo>.<service>` never collides with a web id.
function scope(repo: string, service: ServiceName): string {
  return service === "web" ? repo : `${repo}.${service}`;
}

export class GitPaths {
  getDeploymentsPath(repo: string, service: ServiceName): string {
    return `${config.paths.deployments}/${scope(repo, service)}`;
  }

  getWorktreePath(branch: string, repo: string, service: ServiceName): string {
    return `${this.getDeploymentsPath(repo, service)}/${branch}`;
  }

  getCandidateWorktreePath(
    branch: string,
    repo: string,
    service: ServiceName,
    requestId: string,
  ): string {
    return `${this.getDeploymentsPath(repo, service)}/.releases/${safeBranch(branch)}-${requestId}`;
  }

  getBackupWorktreePath(
    branch: string,
    repo: string,
    service: ServiceName,
    requestId: string,
  ): string {
    return `${this.getDeploymentsPath(repo, service)}/.releases/${safeBranch(branch)}-previous-${requestId}`;
  }

  getDeploymentId(branch: string, repo: string, service: ServiceName): string {
    return `${scope(repo, service)}-${safeBranch(branch)}`;
  }
}
