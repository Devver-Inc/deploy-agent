import { exec, execOrThrow } from "../utils/exec";
import { AsyncMutex } from "../utils/async-mutex";
import { NginxConfigBuilder } from "./nginx/nginx-config-builder";
import { publicHost } from "./nginx/public-address";
import { NginxConfigRepository } from "./nginx/nginx-config-repository";
import { config } from "../config";
import type { OverlayAccessControl, NginxConfigSnapshot } from "../types";

export interface ServiceRoute {
  port: number;
  release?: string;
}

export class NginxManager {
  private builder = new NginxConfigBuilder();
  private repository = new NginxConfigRepository(config.paths.nginxSitesDir);
  private mutex = new AsyncMutex();

  async writeConfig(
    deploymentId: string,
    repo: string,
    branch: string,
    route: ServiceRoute,
    projectId?: string,
    organizationId?: string,
    overlayAccessControl?: OverlayAccessControl,
  ): Promise<void> {
    const content = this.builder.buildSite(
      publicHost(deploymentId),
      repo,
      branch,
      route,
      overlayAccessControl,
      projectId,
      organizationId,
    );

    await this.mutex.run(async () => {
      this.repository.write(deploymentId, content);

      const test = await this.testConfig();
      if (!test.success) {
        try {
          this.repository.remove(deploymentId);
        } catch {}
        throw new Error(`Nginx Config Invalid:\n${test.logs}`);
      }
    });
  }

  async removeConfig(deploymentId: string): Promise<void> {
    this.repository.remove(deploymentId);
  }

  getConfigSnapshot(deploymentId: string): NginxConfigSnapshot {
    return this.repository.snapshot(deploymentId);
  }

  restoreConfig(deploymentId: string, content: string): void {
    this.repository.write(deploymentId, content);
  }

  async testConfig(): Promise<{ success: boolean; logs: string }> {
    const result = await exec("nginx -t");
    return { success: result.success, logs: result.stderr || result.stdout };
  }

  async reload(): Promise<void> {
    await execOrThrow("nginx -s reload");
  }
}

export const nginxManager = new NginxManager();
