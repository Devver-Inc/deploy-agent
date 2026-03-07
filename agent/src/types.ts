export enum PM2ProcessStatus {
  ONLINE = "online",
  STOPPED = "stopped",
  ERRORED = "errored",
}

export enum LogEntryLevel {
  INFO = "info",
  ERROR = "error",
}

export enum DeployStage {
  VALIDATION = "validation",
  WORKTREE = "worktree",
  INSTALL = "install",
  BUILD = "build",
  PROCESS = "process",
  NGINX = "nginx",
  ROLLBACK = "rollback",
}

export enum ErrorCode {
  REPO_NOT_FOUND = "REPO_NOT_FOUND",
  GIT_ERROR = "GIT_ERROR",
  INSTALL_ERROR = "INSTALL_ERROR",
  BUILD_ERROR = "BUILD_ERROR",
  PROCESS_ERROR = "PROCESS_ERROR",
  NGINX_ERROR = "NGINX_ERROR",
  ROLLBACK_ERROR = "ROLLBACK_ERROR",
  DEPLOY_ERROR = "DEPLOY_ERROR",
  PORT_CONFLICT = "PORT_CONFLICT",
  VALIDATION_ERROR = "VALIDATION_ERROR",
}

export interface ServiceConfig {
  root?: string;
  install?: string;
  build: string;
  start: string;
  depends?: string[];
}

export interface CreateRepoRequest {
  name: string;
  baseUrl: string;
}

export interface DeployRequest {
  repo: string;
  branch: string;
  commit?: string;
  services: Record<string, ServiceConfig>;
  links?: Record<string, Record<string, string>>;
  env?: Record<string, Record<string, string>>;
}

export interface ListDeploymentsQuery {
  repo?: string;
}

export interface RepoResponse {
  name: string;
  createdAt: string;
  pushUrl: string;
}

export interface PM2Process {
  name: string;
  pm_id: number;
  status: PM2ProcessStatus;
  cpu: number;
  memory: number;
}

export interface DeploymentResponse {
  repo: string;
  branch: string;
  deploymentId: string;
  services: Record<string, number>;
  processes: PM2Process[];
}

export interface NginxConfigSnapshot {
  exists: boolean;
  content?: string;
}

export interface ServiceDeployResult {
  port: number;
  url: string;
}

export interface DeployResponse {
  success: true;
  branch: string;
  commit: string;
  services: Record<string, ServiceDeployResult>;
  duration: number;
}

export interface ErrorResponse {
  success: false;
  error: {
    code: ErrorCode;
    message: string;
    logs?: string;
    step?: number;
    stage?: DeployStage;
    service?: string;
    rollback?: {
      attempted: boolean;
      success: boolean;
      message?: string;
    };
  };
  duration: number;
}

export interface LogEntry {
  service: string;
  level: LogEntryLevel;
  message: string;
  timestamp: string;
}

export interface LogsResponse {
  logs: LogEntry[];
}

export interface PortRegistry {
  [branch: string]: { [service: string]: number };
}
