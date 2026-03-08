import { safeBranch } from "../../utils/branch";
import type { ServiceRoute } from "../nginx-manager";

export class NginxConfigBuilder {
  private buildUrlPrefix(repo: string, branch: string): string {
    return `/${repo}/${safeBranch(branch)}`;
  }

  build(repo: string, branch: string, services: ServiceRoute[]): string {
    const prefix = this.buildUrlPrefix(repo, branch);

    return services
      .map(({ service, port, path }) => {
        const urlSuffix = path
          ? `/${path.replace(/^\/+/, "")}`
          : service !== "web"
            ? `/${service}`
            : "";
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
        sub_filter_types application/javascript text/javascript;
        sub_filter 'src="/' 'src="${locationPath}/';
        sub_filter 'href="/' 'href="${locationPath}/';
        sub_filter "src='/" "src='${locationPath}/";
        sub_filter "href='/" "href='${locationPath}/";
        sub_filter '"/' '"${locationPath}/';
        sub_filter "'/" "'${locationPath}/";
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
      })
      .join("\n");
  }
}
