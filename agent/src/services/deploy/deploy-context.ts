import type { OverlayAccessControl, NginxConfigSnapshot, PortRegistryEntry } from "../../types";

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

export type DeployPhase =
  | "initial"
  | "validated"
  | "snapshot"
  | "worktree-ready"
  | "port-allocated"
  | "installed"
  | "built"
  | "process-started"
  | "nginx-live";

export interface DeployContext {
  readonly phase: DeployPhase;
  readonly repo: string;
  readonly branch: string;
  readonly deploymentId: string;
  readonly requestId: string;
  commit: string;
  readonly projectId?: string;
  readonly organizationId?: string;
  readonly overlayAccessControl: OverlayAccessControl;
  isNewWorktree?: boolean;
  startedProcess?: string;
  portAllocated?: boolean;
  rollbackSnapshot?: RollbackSnapshot;
  port?: number;
  processName?: string;
  url?: string;
  worktreePath?: string;
  servicePath?: string;
}

export function assertPhase<P extends DeployPhase>(
  ctx: { phase: DeployPhase },
  expected: P
): ctx is { phase: P } & DeployContext {
  if (ctx.phase !== expected) {
    throw new Error(`Expected phase '${expected}', got '${ctx.phase}'`);
  }
  return true;
}

export function isPhase(ctx: { phase: DeployPhase }, expected: DeployPhase): boolean {
  return ctx.phase === expected;
}