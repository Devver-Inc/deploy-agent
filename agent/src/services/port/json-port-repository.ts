import type { PortRegistry, ServiceDeployResult } from "../../types";
import { JsonRegistry } from "../../utils/registry";
import type { PortRepository } from "./port-repository";

export class JsonPortRepository implements PortRepository {
  private registry = new JsonRegistry<PortRegistry>("/app/data/ports.json", {});

  getAll(): PortRegistry {
    return { ...this.registry.entries };
  }

  getBranch(branch: string): Record<string, ServiceDeployResult> | undefined {
    const value = this.registry.get(branch);
    if (!value) return undefined;
    return { ...value };
  }

  setBranch(branch: string, services: Record<string, ServiceDeployResult>): void {
    this.registry.set(branch, { ...services });
  }

  removeBranch(branch: string): void {
    this.registry.remove(branch);
  }
}
