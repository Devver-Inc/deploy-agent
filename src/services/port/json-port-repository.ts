import type { PortRegistry } from "../../types";
import { JsonRegistry } from "../../utils/registry";
import type { PortRepository } from "./port-repository";

export class JsonPortRepository implements PortRepository {
  private registry = new JsonRegistry<PortRegistry>("/app/data/ports.json", {});

  getAll(): PortRegistry {
    return { ...this.registry.entries };
  }

  getBranch(branch: string): Record<string, number> | undefined {
    const value = this.registry.get(branch);
    if (!value) return undefined;
    return { ...value };
  }

  setBranch(branch: string, ports: Record<string, number>): void {
    this.registry.set(branch, { ...ports });
  }

  removeBranch(branch: string): void {
    this.registry.remove(branch);
  }
}
