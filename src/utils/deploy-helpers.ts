import type { ServiceConfig } from "../types";
import { portManager } from "../services/port-manager";

export function topologicalSort(
  services: Record<string, ServiceConfig>,
): string[] {
  const visited = new Set<string>();
  const visiting = new Set<string>();
  const result: string[] = [];

  const visit = (name: string, stack: string[] = []) => {
    if (visited.has(name)) return;
    if (visiting.has(name)) {
      throw new Error(
        `Dependency cycle detected: ${[...stack, name].join(" -> ")}`,
      );
    }

    visiting.add(name);
    visited.add(name);

    for (const dep of services[name]?.depends ?? []) {
      if (!services[dep]) {
        throw new Error(
          `Service '${name}' depends on unknown service '${dep}'.`,
        );
      }
      visit(dep, [...stack, name]);
    }

    visiting.delete(name);
    result.push(name);
  };

  for (const name of Object.keys(services)) visit(name);
  return result;
}

export function prepareSmartCommand(cmd: string, port: number): string {
  const needsDoubleDash = /\b(npm|yarn|pnpm|bun)\s+run\b/.test(cmd);
  const hasPortInCmd = /--port\s+\d+|PORT=\d+/.test(cmd);

  if (hasPortInCmd) return cmd.replace(/--port\s+\d+/, `--port ${port}`);

  const flags = `--port ${port} --host 0.0.0.0`;
  return needsDoubleDash ? `${cmd} -- ${flags}` : `${cmd} ${flags}`;
}

export function buildEnvVars(
  extraEnv: Record<string, string>,
  links: Record<string, string>,
): Record<string, string> {
  const env: Record<string, string> = { NODE_ENV: "production", ...extraEnv };

  for (const [depService, depDeploymentId] of Object.entries(links)) {
    const depPort = portManager.getPort(depDeploymentId, depService);
    if (depPort)
      env[`${depService.toUpperCase()}_URL`] = `http://127.0.0.1:${depPort}`;
  }

  return env;
}
