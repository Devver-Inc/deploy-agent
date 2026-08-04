import { safeBranch } from "../../utils/branch";
import type { OverlayAccessControl } from "../../types";
import type { ServiceRoute } from "../nginx-manager";

const DEVVER_WIDGET_URL = process.env.DEVVER_WIDGET_URL ?? "";

function serializeForInlineScript(value: unknown): string {
  return JSON.stringify(value).replace(/[<>&\u2028\u2029]/g, (character) => {
    const escapes: Record<string, string> = {
      "<": "\\u003c",
      ">": "\\u003e",
      "&": "\\u0026",
      "\u2028": "\\u2028",
      "\u2029": "\\u2029",
    };
    return escapes[character];
  });
}

function escapeHtmlAttribute(value: string): string {
  return value.replace(/[&<>"']/g, (character) => {
    const escapes: Record<string, string> = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;",
    };
    return escapes[character];
  });
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

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
    const ctx = serializeForInlineScript({
      repo,
      branch,
      ...(projectId ? { projectId } : {}),
      ...(organizationId ? { organizationId } : {}),
      ...(overlayAccessControl ? { overlayAccessControl } : {}),
    });
    const widget = DEVVER_WIDGET_URL
      ? `<script src="${escapeHtmlAttribute(DEVVER_WIDGET_URL)}" defer></script>`
      : "";
    return `<script>window.__DEVVER__=${ctx}</script>${widget}</body>`;
  }

  build(
    repo: string,
    branch: string,
    { service, port, nodeFrontend }: ServiceRoute,
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
    const regexLocationPath = escapeRegex(locationPath);
    const nodeFrontendLocations = nodeFrontend
      ? `

    location ~* ^${regexLocationPath}/(assets|static|_next|__vite_ping|@vite|node_modules|@fs|@id)(.*)$ {
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
    }`
      : "";

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
    }${nodeFrontendLocations}`;
  }
}
