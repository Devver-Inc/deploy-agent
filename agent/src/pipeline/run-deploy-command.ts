import { exec } from "../utils/exec";
import { DeployError } from "../utils/deploy-error";
import type { DeployStage, ErrorCode } from "../types";

interface RunDeployCommandOptions {
  command: string;
  cwd: string;
  env: Record<string, string>;
  service: string;
  step: number;
  stage: DeployStage;
  errorCode: ErrorCode;
  errorMessage: (exitCode: number) => string;
  validate: (
    command: string,
    service: string,
    step: number,
    stage: DeployStage,
  ) => void;
  formatLogs: (command: string, stdout: string, stderr: string) => string;
}

export async function runDeployCommand({
  command,
  cwd,
  env,
  service,
  step,
  stage,
  errorCode,
  errorMessage,
  validate,
  formatLogs,
}: RunDeployCommandOptions): Promise<void> {
  validate(command, service, step, stage);
  const result = await exec(command, cwd, { env, user: "deploy" });
  if (result.success) return;

  throw new DeployError(errorCode, errorMessage(result.exitCode), {
    logs: formatLogs(command, result.stdout, result.stderr),
    step,
    stage,
    service,
  });
}
