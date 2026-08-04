import type { DeployStageHandler } from "./stage.interface";
import type { DeployContext } from "../context";
import { getRuntimeEnv } from "../runtime-detector";
import type { RuntimeLanguage } from "../runtime-detector";
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

    await this.runCommand(
      installCmd,
      servicePath,
      serviceName,
      ctx.runtimeLanguage,
      ctx.runtimePackageManager === "pip",
    );
  }

  private async runCommand(
    command: string,
    cwd: string,
    service: string,
    language?: RuntimeLanguage,
    preparePythonVenv = false,
  ): Promise<void> {
    const runtimeEnv = language ? getRuntimeEnv(language, cwd) : {};

    if (preparePythonVenv) {
      await runDeployCommand({
        command: "python -m venv .venv",
        cwd,
        env: runtimeEnv,
        service,
        step: 2,
        stage: DeployStage.INSTALL,
        errorCode: ErrorCode.INSTALL_ERROR,
        errorMessage: () =>
          `Failed to create Python virtual environment for service '${service}'.`,
        validate: this.validateCmd,
        formatLogs: this.formatLogs,
      });
    }

    await runDeployCommand({
      command,
      cwd,
      env: runtimeEnv,
      service,
      step: 2,
      stage: DeployStage.INSTALL,
      errorCode: ErrorCode.INSTALL_ERROR,
      errorMessage: (exitCode) =>
        `INSTALL command failed for service '${service}' (exit code ${exitCode}).`,
      validate: this.validateCmd,
      formatLogs: this.formatLogs,
    });
  }
}
