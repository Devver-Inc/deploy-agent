import type {
  OverlayAccessControl,
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
  code: string;
  message: string;
  logs?: string;
  step?: number;
  stage?: string;
  service?: string;
}

export { DeployContext, assertPhase, isPhase } from "./deploy-context";
export type { DeployPhase } from "./deploy-context";