import type {
  DeployStage,
  ErrorCode,
  NginxConfigSnapshot,
  PortRegistryEntry,
} from "../../types";

export interface RollbackSnapshot {
  previousCommit?: string;
  previousEntry?: PortRegistryEntry;
  nginxConfig: NginxConfigSnapshot;
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
  startedProcess?: string;
  portAllocated: boolean;
  rollbackSnapshot?: RollbackSnapshot;
}
