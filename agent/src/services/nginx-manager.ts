import { exec, execOrThrow } from "../utils/exec";
import { NginxConfigBuilder } from "./nginx/nginx-config-builder";
import { NginxConfigRepository } from "./nginx/nginx-config-repository";
import type { NginxConfigSnapshot } from "../types";

export interface ServiceRoute {
  service: string;
  port: number;
}

export class NginxManager {
  private builder = new NginxConfigBuilder();
  private repository = new NginxConfigRepository();

  async writeConfig(
    deploymentId: string,
    repo: string,
    branch: string,
    route: ServiceRoute,
  ): Promise<void> {
    const config = this.builder.build(repo, branch, route);
    this.repository.write(deploymentId, config);

    const test = await this.testConfig();
    if (!test.success) {
      try {
        this.repository.remove(deploymentId);
      } catch {}
      throw new Error(`Nginx Config Invalid:\n${test.logs}`);
    }
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
