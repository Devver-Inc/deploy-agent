import type { DeployStageHandler } from "./stage.interface";
import type { DeployContext } from "../context";
import type { ServiceRegistry } from "../contracts";
import { DeployError } from "../../utils/deploy-error";
import { pollUntil } from "../../utils/poll-until";
import { publicAddress } from "../../services/nginx/public-address";
import { ErrorCode, DeployStage, type DeployRequest } from "../../types";

/**
 * Generates the dynamic Nginx reverse-proxy configuration for the
 * deployment and reloads Nginx.
 */
export class NginxStage implements DeployStageHandler {
  readonly name = "nginx" as const;

  constructor(private readonly registry: ServiceRegistry) {}

  async execute(ctx: DeployContext, _request: DeployRequest): Promise<void> {
    // Read port from the port registry (set by ProcessStage)
    const entry = this.registry.port.get(ctx.deploymentId);
    if (!entry) {
      throw new DeployError(
        ErrorCode.NGINX_ERROR,
        "No port allocated — cannot write Nginx config.",
        { step: 5, stage: DeployStage.NGINX },
      );
    }

    try {
      ctx.nginxTouched = true;
      await this.registry.nginx.writeConfig(
        ctx.deploymentId,
        ctx.repo,
        ctx.branch,
        {
          service: entry.serviceName,
          port: entry.port,
          nodeFrontend:
            entry.serviceName === "web" &&
            ctx.runtime?.proxyProfile === "node-frontend",
          release: ctx.requestId,
        },
        ctx.projectId,
        ctx.organizationId,
        ctx.overlayAccessControl,
      );
      await this.registry.nginx.reload();
      await this.waitForRelease(
        publicAddress(ctx.deploymentId, ctx.repo, ctx.branch, entry.serviceName),
        ctx.requestId,
      );
    } catch (error: unknown) {
      throw new DeployError(
        ErrorCode.NGINX_ERROR,
        "Failed to write or reload Nginx configuration.",
        {
          logs: error instanceof Error ? error.message : String(error),
          step: 5,
          stage: DeployStage.NGINX,
        },
      );
    }
  }

  /** `nginx -s reload` returns before the new workers serve the config. */
  private async waitForRelease(
    { host, path }: { host?: string; path: string },
    release: string,
  ): Promise<void> {
    await pollUntil(
      async () => {
        try {
          const response = await fetch(`http://127.0.0.1${path}/`, {
            headers: host ? { host } : {},
            redirect: "manual",
            signal: AbortSignal.timeout(2000),
          });
          return response.headers.get("x-devver-release") === release;
        } catch {
          return false;
        }
      },
      10000,
      `Nginx did not serve release ${release} on ${host ?? ""}${path}/ within 10000ms`,
      50,
    );
  }
}
