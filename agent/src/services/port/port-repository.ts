import type { PortRegistry, PortRegistryEntry } from "../../types";

export interface PortRepository {
  getAll(): PortRegistry;
  get(deploymentId: string): PortRegistryEntry | undefined;
  set(deploymentId: string, entry: PortRegistryEntry): void;
  remove(deploymentId: string): void;
}
