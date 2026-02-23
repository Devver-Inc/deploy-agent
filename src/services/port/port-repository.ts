import type { PortRegistry } from "../../types";

export interface PortRepository {
  getAll(): PortRegistry;
  getBranch(branch: string): Record<string, number> | undefined;
  setBranch(branch: string, ports: Record<string, number>): void;
  removeBranch(branch: string): void;
}
