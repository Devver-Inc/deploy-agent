import type { DeployStage, ErrorCode } from "../../types";

export interface RollbackSnapshot {
  previousCommit?: string;
  previousPorts: Record<string, number>;
  nginxConfig: { exists: boolean; content?: string };
}

export interface RollbackResult {
  attempted: boolean;
  success: boolean;
  message?: string;
}

export interface DeployFailure {
  code: ErrorCode;
  message: string;
  logs?: string;
  step?: number;
  stage?: DeployStage;
  service?: string;
}

export interface DeployContext {
  repo: string;
  branch: string;
  deploymentId: string;
  requestId: string;
  commit: string;
  isNewWorktree: boolean;
  startedProcesses: string[];
  allocatedPorts: { deploymentId: string; service: string }[];
  rollbackSnapshot?: RollbackSnapshot;
}
