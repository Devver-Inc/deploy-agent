import type { PortRegistry, ServiceDeployResult } from "../../types";

export interface PortRepository {
  getAll(): PortRegistry;
  getBranch(branch: string): Record<string, ServiceDeployResult> | undefined;
  setBranch(branch: string, services: Record<string, ServiceDeployResult>): void;
  removeBranch(branch: string): void;
}
