import type { OverlayAccessControl } from "../../types";
import type { ServiceRoute } from "../nginx-manager";
import { deploymentPath } from "./public-address";

const DEVVER_WIDGET_URL = process.env.DEVVER_WIDGET_URL ?? "";

function serializeForInlineScript(value: unknown): string {
  // Also embedded in an nginx '...' string, where `$` is a variable.
  return JSON.stringify(value).replace(/[<>&'$\u2028\u2029]/g, (character) => {
    const escapes: Record<string, string> = {
      "<": "\\u003c",
      ">": "\\u003e",
      "&": "\\u0026",
      "'": "\\u0027",
      $: "\\u0024",
      "\u2028": "\\u2028",
      "\u2029": "\\u2029",
    };
    return escapes[character];
  });
}

function escapeNginxSingleQuoted(value: string): string {
  return value.replace(/[\\']/g, (character) => `\\${character}`);
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
    return escapeNginxSingleQuoted(
      `<script>window.__DEVVER__=${ctx}</script>${widget}</body>`,
    );
  }

  buildSite(
    host: string,
    repo: string,
    branch: string,
    { port, release }: ServiceRoute,
    overlayAccessControl?: OverlayAccessControl,
    projectId?: string,
    organizationId?: string,
  ): string {
    const widgetSnippet = this.buildWidgetSnippet(
      repo,
      branch,
      overlayAccessControl,
      projectId,
      organizationId,
    );
    const releaseHeader = release
      ? `\n        add_header X-Devver-Release ${release} always;`
      : "";
    return `
server {
    listen 80;
    server_name ${host};

    location / {
        proxy_pass http://127.0.0.1:${port};
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_set_header Accept-Encoding "";${releaseHeader}
        sub_filter '</body>' '${widgetSnippet}';
    }
}
`;
  }

  build(
    repo: string,
    branch: string,
    { service, port, nodeFrontend, release }: ServiceRoute,
    overlayAccessControl?: OverlayAccessControl,
    projectId?: string,
    organizationId?: string,
  ): string {
    const widgetSnippet = this.buildWidgetSnippet(
      repo,
      branch,
      overlayAccessControl,
      projectId,
      organizationId,
    );
    const locationPath = deploymentPath(repo, branch, service);
    const regexLocationPath = escapeRegex(locationPath);
    const releaseHeader = release
      ? `\n        add_header X-Devver-Release ${release} always;`
      : "";
    const nodeFrontendLocations = nodeFrontend
      ? `

    location ~* ^${regexLocationPath}/(assets|static|_next|__vite_ping|@vite|node_modules|@fs|@id)(.*)$ {
        proxy_pass http://127.0.0.1:${port}/\$1\$2\$is_args\$args;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection "upgrade";
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
        # sub_filter cannot rewrite compressed bodies; nginx gzips after rewriting.
        proxy_set_header Accept-Encoding "";${releaseHeader}
        sub_filter_once off;
        sub_filter_types application/javascript text/javascript;
        # The longest match wins: keep self-closing tags and //host URLs intact.
        sub_filter '"/>' '"/>';
        sub_filter "'/>" "'/>";
        sub_filter '"//' '"//';
        sub_filter "'//" "'//";
        sub_filter '"/' '"${locationPath}/';
        sub_filter "'/" "'${locationPath}/";
        sub_filter '</body>' '${widgetSnippet}';
    }${nodeFrontendLocations}`;
  }
}
