import { safeBranch } from "../../utils/branch";
import { config } from "../../config";
import { safeJoin, toSafeFilename, assertWithin } from "../../utils/path-guard";

export class GitPaths {
  getDeploymentsPath(repo: string): string {
    return safeJoin(config.paths.deployments, toSafeFilename(repo));
  }

  getWorktreePath(branch: string, repo: string): string {
    return safeJoin(this.getDeploymentsPath(repo), safeBranch(branch));
  }

  getDeploymentId(branch: string, repo: string): string {
    return `${repo}-${safeBranch(branch)}`;
  }

  validateWorktreePath(path: string): void {
    assertWithin(config.paths.deployments, path);
  }
}
