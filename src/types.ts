export enum PM2ProcessStatus {
  ONLINE = "online",
  STOPPED = "stopped",
  ERRORED = "errored",
}

export enum LogEntryLevel {
  INFO = "info",
  ERROR = "error",
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

export interface DeployResponse {
  success: true;
  branch: string;
  commit: string;
  services: Record<string, { port: number; url: string }>;
  duration: number;
}

export interface ErrorResponse {
  success: false;
  error: {
    code: ErrorCode;
    message: string;
    logs?: string;
    step?: number;
    service?: string;
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

export type ErrorCode =
  | "GIT_ERROR"
  | "INSTALL_ERROR"
  | "BUILD_ERROR"
  | "PROCESS_ERROR"
  | "PORT_CONFLICT"
  | "NGINX_ERROR"
  | "VALIDATION_ERROR";
