import type { DeploymentResponse, ListDeploymentsQuery } from "../types";
import { matchesDeployment } from "./pm2-manager";
import { defaultRegistry } from "../pipeline/registry";
import type { ServiceRegistry } from "../pipeline/contracts";
import { lifecycleLock } from "./deploy/lifecycle-lock";
import { isValidPm2ProcessName, isValidRepoName } from "../utils/validation";

export class DeploymentAdminService {
  constructor(private readonly registry: ServiceRegistry = defaultRegistry) {}

  async listDeployments(
    query: ListDeploymentsQuery = {},
  ): Promise<DeploymentResponse[]> {
    return lifecycleLock.run(() => this.listDeploymentsUnlocked(query));
  }

  async removeDeployment(deploymentId: string): Promise<void> {
    if (!isValidPm2ProcessName(deploymentId)) {
      throw new Error("Invalid deployment id.");
    }
    await lifecycleLock.run(() => this.removeDeploymentUnlocked(deploymentId));
  }

  async deleteRepo(name: string): Promise<void> {
    if (!isValidRepoName(name)) throw new Error("Invalid repository name.");

    await lifecycleLock.run(async () => {
      const deployments = await this.listDeploymentsUnlocked({ repo: name });
      for (const deployment of deployments) {
        await this.removeDeploymentUnlocked(deployment.deploymentId);
      }
      await this.registry.repo.delete(name);
    });
  }

  async startProcess(name: string): Promise<void> {
    await this.runProcessAction(name, () =>
      this.registry.pm2.startExisting(name),
    );
  }

  async stopProcess(name: string): Promise<void> {
    await this.runProcessAction(name, () => this.registry.pm2.stop(name));
  }

  async restartProcess(name: string): Promise<void> {
    await this.runProcessAction(name, () => this.registry.pm2.restart(name));
  }

  private async runProcessAction(
    name: string,
    action: () => Promise<void>,
  ): Promise<void> {
    if (!isValidPm2ProcessName(name)) throw new Error("Invalid process name.");
    await lifecycleLock.run(action);
  }

  private async listDeploymentsUnlocked({
    repo,
  }: ListDeploymentsQuery): Promise<DeploymentResponse[]> {
    if (repo && !isValidRepoName(repo)) {
      throw new Error("Invalid repository name.");
    }

    const repos = repo
      ? [repo]
      : this.registry.repo.list().map((entry) => entry.name);
    const processes = await this.registry.pm2.list();
    const ports = this.registry.port.getAll();
    const results: DeploymentResponse[] = [];

    for (const currentRepo of repos) {
      const branches = await this.registry.git.listWorktrees(currentRepo);
      for (const branch of branches) {
        const deploymentId = this.registry.git.getDeploymentId(
          branch,
          currentRepo,
        );
        const entry = ports[deploymentId];
        results.push({
          repo: currentRepo,
          branch,
          deploymentId,
          commit: await this.registry.git.getCurrentCommit(branch, currentRepo),
          service: entry
            ? { [entry.serviceName]: { port: entry.port, url: entry.url } }
            : {},
          process:
            processes.find((process) =>
              matchesDeployment(process.name, deploymentId),
            ) ?? null,
        });
      }
    }
    return results;
  }

  private async removeDeploymentUnlocked(deploymentId: string): Promise<void> {
    const location = await this.findDeploymentLocation(deploymentId);
    const portEntry = this.registry.port.getAll()[deploymentId];

    await this.registry.pm2.deleteByDeployment(deploymentId);
    if (portEntry) await this.registry.pm2.killPort(portEntry.port);
    await Promise.all([
      location
        ? this.registry.git.removeWorktree(location.branch, location.repo)
        : Promise.resolve(),
      this.registry.nginx.removeConfig(deploymentId),
    ]);
    this.registry.port.release(deploymentId);
    await this.registry.nginx.reload();
  }

  private async findDeploymentLocation(
    deploymentId: string,
  ): Promise<{ branch: string; repo: string } | undefined> {
    for (const { name: repo } of this.registry.repo.list()) {
      const branch = (await this.registry.git.listWorktrees(repo)).find(
        (candidate) =>
          this.registry.git.getDeploymentId(candidate, repo) === deploymentId,
      );
      if (branch) return { branch, repo };
    }
  }
}

export const deploymentAdminService = new DeploymentAdminService();
