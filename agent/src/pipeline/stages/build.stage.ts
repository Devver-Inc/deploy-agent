import type { DeployStageHandler } from "./stage.interface";
import type { DeployContext } from "../context";
import { DeployError } from "../../utils/deploy-error";
import { runDeployCommand } from "../run-deploy-command";
import { ErrorCode, DeployStage, type DeployRequest } from "../../types";

/**
 * Runs the build command (if provided) in the service worktree.
 */
export class BuildStage implements DeployStageHandler {
  readonly name = "build" as const;

  constructor(
    private readonly validateCmd: (
      cmd: string,
      service: string,
      step: number,
      stage: DeployStage,
    ) => void,
    private readonly formatLogs: (
      cmd: string,
      stdout: string,
      stderr: string,
    ) => string,
  ) {}

  async execute(ctx: DeployContext, _request: DeployRequest): Promise<void> {
    const serviceName = ctx.serviceName;
    const config = ctx.serviceConfig;
    if (!serviceName || !config?.build) return;

    if (!ctx.servicePath) {
      throw new DeployError(
        ErrorCode.BUILD_ERROR,
        "Service path was not prepared before build.",
        { step: 3, stage: DeployStage.BUILD, service: serviceName },
      );
    }

    const runtimeEnv = ctx.runtime?.environment(ctx.servicePath, "build") ?? {};

    await runDeployCommand({
      command: config.build,
      cwd: ctx.servicePath,
      env: runtimeEnv,
      service: serviceName,
      step: 3,
      stage: DeployStage.BUILD,
      errorCode: ErrorCode.BUILD_ERROR,
      errorMessage: (exitCode) =>
        `BUILD command failed for service '${serviceName}' (exit code ${exitCode}).`,
      validate: this.validateCmd,
      formatLogs: this.formatLogs,
    });
  }
}
