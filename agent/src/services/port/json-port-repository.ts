import type { PortRegistry, PortRegistryEntry } from "../../types";
import { JsonRegistry } from "../../utils/registry";
import type { PortRepository } from "./port-repository";

export class JsonPortRepository implements PortRepository {
  private registry = new JsonRegistry<PortRegistry>("/app/data/ports.json", {});

  getAll(): PortRegistry {
    return { ...this.registry.entries };
  }

  get(deploymentId: string): PortRegistryEntry | undefined {
    return this.registry.get(deploymentId);
  }

  set(deploymentId: string, entry: PortRegistryEntry): void {
    this.registry.set(deploymentId, { ...entry });
  }

  remove(deploymentId: string): void {
    this.registry.remove(deploymentId);
  }
}
