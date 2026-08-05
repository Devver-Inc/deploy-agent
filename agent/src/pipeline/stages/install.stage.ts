import type { DeployStageHandler } from "./stage.interface";
import type { DeployContext } from "../context";
import { DeployError } from "../../utils/deploy-error";
import { runDeployCommand } from "../run-deploy-command";
import { ErrorCode, DeployStage, type DeployRequest } from "../../types";

/**
 * Runs the install command (e.g. `bun install`, `pip install`) in the
 * service worktree directory. Injects cache env vars so persistent
 * Docker volumes are reused across deploys.
 */
export class InstallStage implements DeployStageHandler {
  readonly name = "install" as const;

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
    if (!serviceName || !config) return;
    if (config.skipInstall) return;
    if (!config.install) return;

    const installCmd = config.install;
    const servicePath = ctx.servicePath;
    if (!servicePath) {
      throw new DeployError(
        ErrorCode.INSTALL_ERROR,
        "Service path was not prepared before install.",
        { step: 2, stage: DeployStage.INSTALL, service: serviceName },
      );
    }

    const runtimeEnv = ctx.runtime?.environment(servicePath, "install") ?? {};
    for (const command of ctx.runtime?.beforeInstallCommands ?? []) {
      await this.runCommand(
        command,
        servicePath,
        serviceName,
        runtimeEnv,
        `Runtime preparation command failed for service '${serviceName}'.`,
      );
    }

    await this.runCommand(
      installCmd,
      servicePath,
      serviceName,
      runtimeEnv,
      undefined,
    );
  }

  private async runCommand(
    command: string,
    cwd: string,
    service: string,
    env: Record<string, string>,
    failureMessage?: string,
  ): Promise<void> {
    await runDeployCommand({
      command,
      cwd,
      env,
      service,
      step: 2,
      stage: DeployStage.INSTALL,
      errorCode: ErrorCode.INSTALL_ERROR,
      errorMessage: (exitCode) =>
        failureMessage ??
        `INSTALL command failed for service '${service}' (exit code ${exitCode}).`,
      validate: this.validateCmd,
      formatLogs: this.formatLogs,
    });
  }
}
