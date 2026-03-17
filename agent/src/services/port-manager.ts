import { createServer } from "net";
import type { PortRegistry, PortRegistryEntry } from "../types";
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
    for (const entry of Object.values(this.repository.getAll())) {
      ports.add(entry.port);
    }
    return ports;
  }

  async allocate(deploymentId: string): Promise<number> {
    return this.withLock(async () => {
      const existing = this.repository.get(deploymentId);
      if (existing) return existing.port;

      const allocated = this.getAllocatedPorts();
      let port = BASE_PORT;
      while (port < MAX_PORT) {
        if (!allocated.has(port) && (await isPortAvailable(port))) break;
        port++;
      }
      if (port >= MAX_PORT) throw new Error("No available ports");

      this.repository.set(deploymentId, { serviceName: "", port, url: "" });
      return port;
    });
  }

  update(deploymentId: string, entry: PortRegistryEntry): void {
    this.repository.set(deploymentId, entry);
  }

  get(deploymentId: string): PortRegistryEntry | undefined {
    return this.repository.get(deploymentId);
  }

  release(deploymentId: string): void {
    this.repository.remove(deploymentId);
  }

  getAll(): PortRegistry {
    return this.repository.getAll();
  }
}

export const portManager = new PortManager();
