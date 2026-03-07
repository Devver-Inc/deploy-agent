import { existsSync, readFileSync, unlinkSync, writeFileSync } from "fs";
import { ensureDir } from "../../utils/fs";
import type { NginxConfigSnapshot } from "../../types";

const NGINX_CONF_DIR = "/app/nginx/conf.d";

export class NginxConfigRepository {
  getConfigPath(deploymentId: string): string {
    return `${NGINX_CONF_DIR}/${deploymentId}.conf`;
  }

  write(deploymentId: string, content: string): void {
    ensureDir(NGINX_CONF_DIR);
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
