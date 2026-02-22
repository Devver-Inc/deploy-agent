import { createServer } from 'net';
import type { PortRegistry } from '../types';
import { JsonRegistry } from '../utils/registry';

const BASE_PORT = 3000;
const MAX_PORT = 9000;

async function isPortAvailable(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = createServer();
    server.once('error', () => resolve(false));
    server.once('listening', () => { server.close(); resolve(true); });
    server.listen(port, '127.0.0.1');
  });
}

export class PortManager {
  private registry = new JsonRegistry<PortRegistry>('/app/data/ports.json', {});

  private getAllocatedPorts(): Set<number> {
    const ports = new Set<number>();
    for (const branch of Object.values(this.registry.entries)) {
      for (const port of Object.values(branch)) ports.add(port);
    }
    return ports;
  }

  async allocate(branch: string, service: string): Promise<number> {
    const existing = this.registry.get(branch)?.[service];
    if (existing) {
      if (await isPortAvailable(existing)) return existing;
      this.release(branch, service);
    }

    const allocated = this.getAllocatedPorts();
    let port = BASE_PORT;
    while (port < MAX_PORT) {
      if (!allocated.has(port) && await isPortAvailable(port)) break;
      port++;
    }
    if (port >= MAX_PORT) throw new Error('No available ports');

    const branchPorts = this.registry.get(branch) ?? {};
    branchPorts[service] = port;
    this.registry.set(branch, branchPorts);
    return port;
  }

  getPort(branch: string, service: string): number | undefined {
    return this.registry.get(branch)?.[service];
  }

  getBranchPorts(branch: string): Record<string, number> {
    return this.registry.get(branch) ?? {};
  }

  release(branch: string, service?: string): void {
    const branchPorts = this.registry.get(branch);
    if (!branchPorts) return;

    if (service) {
      delete branchPorts[service];
      if (Object.keys(branchPorts).length === 0) {
        this.registry.remove(branch);
      } else {
        this.registry.set(branch, branchPorts);
      }
    } else {
      this.registry.remove(branch);
    }
  }

  getAll(): PortRegistry {
    return { ...this.registry.entries };
  }
}

export const portManager = new PortManager();
