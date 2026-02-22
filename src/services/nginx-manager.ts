import { writeFileSync, unlinkSync, existsSync } from "fs";
import { exec, execOrThrow } from "../utils/exec";
import { ensureDir } from "../utils/fs";

const NGINX_CONF_DIR = "/app/nginx/conf.d";

export interface ServiceRoute {
  service: string;
  port: number;
  path?: string;
}

export class NginxManager {
  private safeId(id: string): string {
    return id.replace(/\//g, "-").toLowerCase();
  }

  private buildUrlPrefix(repo: string, branch: string): string {
    const safeBranch = branch.replace(/\//g, "-").toLowerCase();
    return `/${repo}/${safeBranch}`;
  }

  generateLocationBlock(deploymentId: string, repo: string, branch: string, services: ServiceRoute[]): string {
    const prefix = this.buildUrlPrefix(repo, branch);

    const locations = services.map(({ service, port, path }) => {
      const urlSuffix = path ? `/${path.replace(/^\/+/, "")}` : service !== "web" ? `/${service}` : "";
      const locationPath = `${prefix}${urlSuffix}`;

      return `
    location = ${locationPath} {
        return 301 \$scheme://\$http_host${locationPath}/;
    }

    location ${locationPath}/ {
        proxy_pass http://127.0.0.1:${port}/;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        sub_filter_once off;
        sub_filter_types text/html application/javascript;
        sub_filter 'src="/' 'src="${locationPath}/';
        sub_filter 'href="/' 'href="${locationPath}/';
        sub_filter "src='/" "src='${locationPath}/";
        sub_filter "href='/" "href='${locationPath}/";
    }

    location ~* ^${locationPath}/(assets|static|_next|__vite_ping|@vite|node_modules|@fs|@id)(.*)$ {
        proxy_pass http://127.0.0.1:${port}/\$1\$2;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_cache_bypass 1;
    }

    location ${locationPath}/__hmr {
        proxy_pass http://127.0.0.1:${port}/__hmr;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection "upgrade";
    }`;
    }).join("\n");

    return locations;
  }

  async writeConfig(deploymentId: string, repo: string, branch: string, services: ServiceRoute[]): Promise<void> {
    ensureDir(NGINX_CONF_DIR);
    const config = this.generateLocationBlock(deploymentId, repo, branch, services);
    const configPath = `${NGINX_CONF_DIR}/${deploymentId}.conf`;

    writeFileSync(configPath, config);

    const test = await this.testConfig();
    if (!test.success) {
      try { unlinkSync(configPath); } catch {}
      throw new Error(`Nginx Config Invalid:\n${test.logs}`);
    }
  }

  async removeConfig(deploymentId: string): Promise<void> {
    const configPath = `${NGINX_CONF_DIR}/${deploymentId}.conf`;
    if (existsSync(configPath)) {
      unlinkSync(configPath);
    }
  }

  async testConfig(): Promise<{ success: boolean; logs: string }> {
    const result = await exec("nginx -t");
    return { success: result.success, logs: result.stderr || result.stdout };
  }

  async reload(): Promise<void> {
    const { success, logs } = await this.testConfig();
    if (!success) throw new Error(`Cannot reload Nginx:\n${logs}`);
    await execOrThrow("nginx -s reload");
  }
}

export const nginxManager = new NginxManager();
