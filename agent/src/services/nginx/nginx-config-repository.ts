import { existsSync, readFileSync, unlinkSync, writeFileSync } from "fs";
import { ensureDir } from "../../utils/fs";
import type { NginxConfigSnapshot } from "../../types";
import { config } from "../../config";
import { isValidPm2ProcessName } from "../../utils/validation";

export class NginxConfigRepository {
  getConfigPath(deploymentId: string): string {
    if (!isValidPm2ProcessName(deploymentId)) {
      throw new Error("Invalid deployment id.");
    }
    return `${config.paths.nginxConfDir}/${deploymentId}.conf`;
  }

  write(deploymentId: string, content: string): void {
    ensureDir(config.paths.nginxConfDir);
    writeFileSync(this.getConfigPath(deploymentId), content);
  }

  remove(deploymentId: string): void {
    const configPath = this.getConfigPath(deploymentId);
    if (existsSync(configPath)) {
      unlinkSync(configPath);
    }
  }

  snapshot(deploymentId: string): NginxConfigSnapshot {
    const configPath = this.getConfigPath(deploymentId);
    if (!existsSync(configPath)) return { exists: false };
    return { exists: true, content: readFileSync(configPath, "utf-8") };
  }
}
