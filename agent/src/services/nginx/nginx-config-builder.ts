import { safeBranch } from "../../utils/branch";
import type { OverlayAccessControl } from "../../types";
import type { ServiceRoute } from "../nginx-manager";
import { DeployError } from "../../utils/errors";

const DEVVER_WIDGET_URL = process.env.DEVVER_WIDGET_URL ?? "";

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "\\u0026")
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/"/g, "\\u0022")
    .replace(/'/g, "\\u0027");
}

function validateWidgetUrl(url: string): void {
  if (url && !url.startsWith("https://")) {
    throw DeployError.validation("DEVVER_WIDGET_URL must use HTTPS", { url });
  }
}

validateWidgetUrl(DEVVER_WIDGET_URL);

export class NginxConfigBuilder {
  private buildUrlPrefix(repo: string, branch: string): string {
    return `/${repo}/${safeBranch(branch)}`;
  }

  private buildWidgetSnippet(
    repo: string,
    branch: string,
    overlayAccessControl?: OverlayAccessControl,
    projectId?: string,
    organizationId?: string,
  ): string {
    const ctx = JSON.stringify({
      repo,
      branch,
      ...(projectId ? { projectId } : {}),
      ...(organizationId ? { organizationId } : {}),
      ...(overlayAccessControl ? { overlayAccessControl } : {}),
    });
    const escapedCtx = escapeHtml(ctx);
    return `<script>window.__DEVVER__=${escapedCtx}</script><script src="${DEVVER_WIDGET_URL}" defer></script></body>`;
  }

  build(
    repo: string,
    branch: string,
    { service, port }: ServiceRoute,
    overlayAccessControl?: OverlayAccessControl,
    projectId?: string,
    organizationId?: string,
  ): string {
    const prefix = this.buildUrlPrefix(repo, branch);
    const widgetSnippet = this.buildWidgetSnippet(
      repo,
      branch,
      overlayAccessControl,
      projectId,
      organizationId,
    );
    const urlSuffix = service !== "web" ? `/${service}` : "";
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
        sub_filter '</body>' '${widgetSnippet}';
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
  }
}
