import { existsSync, readFileSync, unlinkSync, writeFileSync } from "fs";
import { ensureDir } from "../../utils/fs";
import type { NginxConfigSnapshot } from "../../types";
import { config } from "../../config";
import { safeJoin, toSafeFilename, assertWithin } from "../../utils/path-guard";

export class NginxConfigRepository {
  getConfigPath(deploymentId: string): string {
    const safeId = toSafeFilename(deploymentId);
    return safeJoin(config.paths.nginxConfDir, `${safeId}.conf`);
  }

  write(deploymentId: string, content: string): void {
    ensureDir(config.paths.nginxConfDir);
    const configPath = this.getConfigPath(deploymentId);
    assertWithin(config.paths.nginxConfDir, configPath);
    writeFileSync(configPath, content);
  }

  remove(deploymentId: string): void {
    const configPath = this.getConfigPath(deploymentId);
    if (existsSync(configPath)) {
      assertWithin(config.paths.nginxConfDir, configPath);
      unlinkSync(configPath);
    }
  }

  snapshot(deploymentId: string): NginxConfigSnapshot {
    const configPath = this.getConfigPath(deploymentId);
    assertWithin(config.paths.nginxConfDir, configPath);
    if (!existsSync(configPath)) return { exists: false };
    return { exists: true, content: readFileSync(configPath, "utf-8") };
  }
}
