import { createServer } from "net";
import type { PortRegistry, ServiceDeployResult } from "../types";
import { JsonPortRepository } from "./port/json-port-repository";
import type { PortRepository } from "./port/port-repository";

const BASE_PORT = 3000;
const MAX_PORT = 9000;

async function isPortAvailable(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = createServer();
    server.once("error", () => resolve(false));
    server.once("listening", () => {
      server.close();
      resolve(true);
    });
    server.listen(port, "127.0.0.1");
  });
}

export class PortManager {
  constructor(private repository: PortRepository = new JsonPortRepository()) {}

  private queue: Promise<void> = Promise.resolve();

  private async withLock<T>(fn: () => Promise<T> | T): Promise<T> {
    let release: () => void = () => {};
    const next = new Promise<void>((resolve) => {
      release = resolve;
    });

    const previous = this.queue;
    this.queue = previous.then(() => next);

    await previous;
    try {
      return await fn();
    } finally {
      release();
    }
  }

  private getAllocatedPorts(): Set<number> {
    const ports = new Set<number>();
    for (const branch of Object.values(this.repository.getAll())) {
      for (const svc of Object.values(branch)) ports.add(svc.port);
    }
    return ports;
  }

  async allocate(branch: string, service: string): Promise<number> {
    return this.withLock(async () => {
      const existing = this.repository.getBranch(branch)?.[service];
      if (existing) {
        return existing.port;
      }

      const allocated = this.getAllocatedPorts();
      let port = BASE_PORT;
      while (port < MAX_PORT) {
        if (!allocated.has(port) && (await isPortAvailable(port))) break;
        port++;
      }
      if (port >= MAX_PORT) throw new Error("No available ports");

      const branchServices = this.repository.getBranch(branch) ?? {};
      branchServices[service] = { port, url: "" };
      this.repository.setBranch(branch, branchServices);
      return port;
    });
  }

  updateService(branch: string, service: string, result: ServiceDeployResult): void {
    const branchServices = this.repository.getBranch(branch) ?? {};
    branchServices[service] = result;
    this.repository.setBranch(branch, branchServices);
  }

  getPort(branch: string, service: string): number | undefined {
    return this.repository.getBranch(branch)?.[service]?.port;
  }

  getBranchPorts(branch: string): Record<string, ServiceDeployResult> {
    return this.repository.getBranch(branch) ?? {};
  }

  setBranchPorts(branch: string, services: Record<string, ServiceDeployResult>): void {
    if (Object.keys(services).length === 0) {
      this.repository.removeBranch(branch);
      return;
    }
    this.repository.setBranch(branch, { ...services });
  }

  release(branch: string, service?: string): void {
    const branchServices = this.repository.getBranch(branch);
    if (!branchServices) return;

    if (service) {
      delete branchServices[service];
      if (Object.keys(branchServices).length === 0) {
        this.repository.removeBranch(branch);
      } else {
        this.repository.setBranch(branch, branchServices);
      }
    } else {
      this.repository.removeBranch(branch);
    }
  }

  getAll(): PortRegistry {
    return this.repository.getAll();
  }
}

export const portManager = new PortManager();
