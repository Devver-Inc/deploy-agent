import type { DeployStageHandler } from "./stage.interface";
import type { DeployContext } from "../context";
import type { ServiceRegistry } from "../contracts";
import { DeployError } from "../../utils/deploy-error";
import { pollUntil } from "../../utils/poll-until";
import { ErrorCode, DeployStage, type DeployRequest } from "../../types";
import { safeBranch } from "../../utils/branch";
import { resolvePathWithin } from "../../utils/validation";

/**
 * Promotes the candidate, starts the PM2 process and waits for health.
 */
export class ProcessStage implements DeployStageHandler {
  readonly name = "process" as const;

  constructor(
    private readonly registry: ServiceRegistry,
    private readonly validateCmd: (
      cmd: string,
      service: string,
      step: number,
      stage: DeployStage,
    ) => void,
  ) {}

  async execute(ctx: DeployContext, request: DeployRequest): Promise<void> {
    const serviceName = ctx.serviceName;
    const config = ctx.serviceConfig;
    if (!serviceName || !config) return;

    // Allocate port
    let port: number;
    try {
      port = await this.registry.port.allocate(ctx.deploymentId, serviceName);
      ctx.portAllocated = true;
    } catch (error: unknown) {
      throw new DeployError(
        ErrorCode.PORT_CONFLICT,
        `Failed to allocate port for service '${serviceName}'.`,
        {
          logs: error instanceof Error ? error.message : String(error),
          step: 4,
          stage: DeployStage.PROCESS,
          service: serviceName,
        },
      );
    }

    const extraEnv = request.env ?? {};
    let servicePath = ctx.servicePath;
    if (!servicePath) {
      throw new DeployError(
        ErrorCode.PROCESS_ERROR,
        "Service path was not prepared before process start.",
        { step: 4, stage: DeployStage.PROCESS, service: serviceName },
      );
    }

    // Prepare start command
    const rawCommand = config.start!;
    this.validateCmd(rawCommand, serviceName, 4, DeployStage.PROCESS);
    const command =
      serviceName === "web"
        ? (ctx.runtime?.prepareStart(rawCommand, port) ?? rawCommand)
        : rawCommand;

    // Start PM2 process
    try {
      const activeWorktreePath =
        await this.registry.git.promoteCandidateWorktree(
          ctx.branch,
          ctx.repo,
          ctx.requestId,
        );
      ctx.worktreePromoted = true;
      servicePath = resolvePathWithin(
        activeWorktreePath,
        ctx.serviceConfig?.root,
      );
      ctx.servicePath = servicePath;
      const runtimeEnv = ctx.runtime?.environment(servicePath, "run") ?? {};

      ctx.processTouched = true;
      await this.registry.pm2.start(
        serviceName,
        ctx.deploymentId,
        port,
        command,
        servicePath,
        { ...runtimeEnv, ...extraEnv },
      );
      await this.waitForPort(port, serviceName);

      const baseUrl = this.registry.repo.getBaseUrl(ctx.repo);
      const url = `${baseUrl}/${ctx.repo}/${safeBranch(ctx.branch)}${serviceName !== "web" ? `/${serviceName}` : ""}`;
      this.registry.port.update(ctx.deploymentId, {
        serviceName,
        port,
        url,
      });
    } catch (error: unknown) {
      throw new DeployError(
        ErrorCode.PROCESS_ERROR,
        `Failed to start process for service '${serviceName}'.`,
        {
          logs: error instanceof Error ? error.message : String(error),
          service: serviceName,
          step: 4,
          stage: DeployStage.PROCESS,
        },
      );
    }
  }

  private async waitForPort(
    port: number,
    service: string,
    timeoutMs = 60000,
  ): Promise<void> {
    await pollUntil(
      async () => {
        try {
          const response = await fetch(`http://127.0.0.1:${port}`, {
            signal: AbortSignal.timeout(1000),
          });
          return response.status < 500;
        } catch {
          return false;
        }
      },
      timeoutMs,
      `Service '${service}' did not respond on port ${port} within ${timeoutMs}ms`,
    );
  }
}
