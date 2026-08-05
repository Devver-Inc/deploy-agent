import type {
  OverlayAccessControl,
  DeployBenchmark,
  RollbackSnapshot,
  ServiceConfig,
  ServiceName,
} from "../types";
import type {
  RuntimeLanguage,
  RuntimePackageManager,
} from "./runtime-detector";

/**
 * Mutable deployment context shared across all pipeline stages.
 *
 * Each stage may set fields as it progresses; the pipeline merges
 * partial results so the final context reflects the full state.
 */
export interface DeployContext {
  repo: string;
  branch: string;
  deploymentId: string;
  requestId: string;
  commit: string;
  projectId?: string;
  organizationId?: string;
  overlayAccessControl: OverlayAccessControl;

  // State flags set by stages during execution
  worktreeTouched: boolean;
  worktreePromoted: boolean;
  processTouched: boolean;
  nginxTouched: boolean;
  portAllocated: boolean;
  rollbackSnapshot?: RollbackSnapshot;
  benchmark: DeployBenchmark;

  serviceName?: ServiceName;
  serviceConfig?: ServiceConfig;
  servicePath?: string;
  runtimeLanguage?: RuntimeLanguage;
  runtimePackageManager?: RuntimePackageManager;
  runtimeNeedsCliPort?: boolean;

  onPhaseComplete?: (phase: keyof DeployBenchmark, durationMs: number) => void;
}
