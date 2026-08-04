import type {
  NginxConfigSnapshot,
  OverlayAccessControl,
  PM2Process,
  PortRegistry,
  PortRegistryEntry,
  ProcessSnapshot,
  RepoConfig,
  ServiceName,
} from "../types";

export interface ServiceRegistry {
  readonly git: {
    createCandidateWorktree(
      branch: string,
      commit: string | undefined,
      repo: string,
      requestId: string,
    ): Promise<string>;
    promoteCandidateWorktree(
      branch: string,
      repo: string,
      requestId: string,
    ): Promise<string>;
    rollbackPromotion(
      branch: string,
      repo: string,
      requestId: string,
    ): Promise<void>;
    discardCandidateWorktree(
      branch: string,
      repo: string,
      requestId: string,
    ): Promise<void>;
    cleanupBackupWorktree(
      branch: string,
      repo: string,
      requestId: string,
    ): Promise<void>;
    getCommitAtPath(worktreePath: string): Promise<string>;
    removeWorktree(branch: string, repo: string): Promise<void>;
    listWorktrees(repo: string): Promise<string[]>;
    getCurrentCommit(branch: string, repo: string): Promise<string>;
    getDeploymentId(branch: string, repo: string): string;
  };
  readonly pm2: {
    start(
      service: string,
      deploymentId: string,
      port: number,
      startCommand: string,
      cwd: string,
      env?: Record<string, string>,
    ): Promise<string>;
    list(): Promise<PM2Process[]>;
    deleteByDeployment(deploymentId: string): Promise<void>;
    killPort(port: number): Promise<void>;
    snapshotDeployment(deploymentId: string): Promise<ProcessSnapshot[]>;
    restoreSnapshots(snapshots: ProcessSnapshot[]): Promise<void>;
    startExisting(name: string): Promise<void>;
    stop(name: string): Promise<void>;
    restart(name: string): Promise<void>;
  };
  readonly nginx: {
    writeConfig(
      deploymentId: string,
      repo: string,
      branch: string,
      route: { service: string; port: number; nodeFrontend?: boolean },
      projectId?: string,
      organizationId?: string,
      overlayAccessControl?: OverlayAccessControl,
    ): Promise<void>;
    removeConfig(deploymentId: string): Promise<void>;
    getConfigSnapshot(deploymentId: string): NginxConfigSnapshot;
    restoreConfig(deploymentId: string, content: string): void;
    reload(): Promise<void>;
  };
  readonly port: {
    allocate(deploymentId: string, serviceName: ServiceName): Promise<number>;
    update(deploymentId: string, entry: PortRegistryEntry): void;
    get(deploymentId: string): PortRegistryEntry | undefined;
    release(deploymentId: string): void;
    getAll(): PortRegistry;
  };
  readonly repo: {
    exists(name: string): boolean;
    delete(name: string): Promise<void>;
    list(): RepoConfig[];
    getBaseUrl(name: string): string;
  };
}
