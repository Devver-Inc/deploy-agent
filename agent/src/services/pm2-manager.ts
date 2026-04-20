import { writeFile } from "fs/promises";
import { createServer } from "net";
import { exec, execOrThrow } from "../utils/exec";
import { ensureDir } from "../utils/fs";
import type { PM2Process, LogEntry } from "../types";
import {
  buildProcessName,
  matchesProcess,
  matchesDeployment,
} from "./pm2/pm2-process-name";
import { parsePm2Logs } from "./pm2/pm2-log-parser";
import { config } from "../config";
import { pollUntil } from "../utils/poll-until";

export { matchesDeployment };

export class PM2Manager {
  async start(
    service: string,
    branch: string,
    port: number,
    bin: string,
    argv: readonly string[],
    cwd: string,
    env: Record<string, string> = {},
  ): Promise<string> {
    const name = buildProcessName(service, branch, port);

    const existing = (await this.list()).filter((p) =>
      matchesProcess(p.name, service, branch),
    );
    await Promise.all(existing.map((p) => this.delete(p.name)));

    const stillExisting = (await this.list()).filter((p) =>
      matchesProcess(p.name, service, branch),
    );
    if (stillExisting.length > 0) {
      throw new Error(
        `Failed to delete existing processes before redeploy: ${stillExisting.map((p) => p.name).join(", ")}`,
      );
    }

    await this.killPort(port);
    await this.waitForPortFree(port);

    const envVars = { ...env, PORT: port.toString(), HOST: "0.0.0.0" };
    ensureDir(config.paths.pm2Data);
    const ecosystemFile = `${config.paths.pm2Data}/${name}.config.js`;

    await writeFile(
      ecosystemFile,
      `module.exports = {
  apps: [{
    name: "${name}",
    script: "${bin}",
    args: ${JSON.stringify([...argv])},
    cwd: "${cwd}",
    interpreter: "none",
    env: ${JSON.stringify(envVars)},
    watch: false,
    autorestart: true,
    max_restarts: 5,
    kill_timeout: 5000,
    treekill: true,
  }]
};`,
    );

    await execOrThrow("pm2", ["start", ecosystemFile], cwd);
    await this.waitForProcess(name);
    await execOrThrow("pm2", ["save"]);

    return name;
  }

  async waitForProcess(name: string, timeoutMs = 30000): Promise<void> {
    await pollUntil(
      async () => {
        const proc = (await this.list()).find((p) => p.name === name);
        if (proc?.status === "errored") {
          throw new Error(
            `Process ${name} failed:\n${await this.getLogs(name, 20)}`,
          );
        }
        return proc?.status === "online";
      },
      timeoutMs,
      `Process ${name} timed out after ${timeoutMs}ms`,
    );
  }

  async stop(name: string): Promise<void> {
    await execOrThrow("pm2", ["stop", name]);
    await execOrThrow("pm2", ["save"]);
  }

  async restart(name: string): Promise<void> {
    await execOrThrow("pm2", ["restart", name]);
  }

  async delete(name: string): Promise<void> {
    await execOrThrow("pm2", ["delete", name]);
  }

  async deleteByBranch(branch: string): Promise<void> {
    const processes = await this.list();
    const matches = processes.filter((p) =>
      matchesDeployment(p.name, branch),
    );
    await Promise.all(matches.map((p) => this.stop(p.name)));
    await Promise.all(matches.map((p) => this.delete(p.name)));
  }

  async startExisting(name: string): Promise<void> {
    await execOrThrow("pm2", ["start", name]);
  }

  async killPort(port: number): Promise<void> {
    const processes = await this.list();
    const match = processes.find(
      (p) => p.name.includes(`-${port}-`) || p.name.endsWith(`-${port}`),
    );
    if (match) {
      await this.stop(match.name);
      await this.delete(match.name);
    }
  }

  async waitForPortFree(port: number, timeoutMs = 10000): Promise<void> {
    await pollUntil(
      async () => {
        const isFree = await this.isPortFree(port);
        return isFree;
      },
      timeoutMs,
      `Port ${port} did not become free within ${timeoutMs}ms`,
    );
  }

  private isPortFree(port: number): Promise<boolean> {
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

  async list(): Promise<PM2Process[]> {
    try {
      const result = await exec("pm2", ["jlist"]);
      if (!result.success) {
        return [];
      }
      const data = JSON.parse(result.stdout);
      return data.map((p: any) => ({
        name: p.name,
        pm_id: p.pm_id,
        status: p.pm2_env?.status || "stopped",
        cpu: p.monit?.cpu || 0,
        memory: p.monit?.memory || 0,
      }));
    } catch {
      return [];
    }
  }

  async getLogs(name: string, lines = 100): Promise<string> {
    try {
      const result = await exec("pm2", ["logs", name, "--nostream", "--lines", String(lines)]);
      return result.stdout || result.stderr;
    } catch {
      return "";
    }
  }

  async getLogPath(name: string): Promise<string | null> {
    try {
      const result = await exec("pm2", ["jlist"]);
      if (!result.success) return null;
      const data = JSON.parse(result.stdout);
      const proc = data.find((p: any) => p.name === name);
      return proc?.pm2_env?.pm_out_log_path || null;
    } catch {
      return null;
    }
  }

  async parseLogs(name: string, lines = 100): Promise<LogEntry[]> {
    const logs = await this.getLogs(name, lines);
    return parsePm2Logs(logs);
  }

  async getLogsByDeployment(deploymentId: string, lines = 100): Promise<LogEntry[]> {
    const processes = await this.list();
    const process = processes.find(p => p.name.includes(deploymentId));
    if (!process) return [];
    return this.parseLogs(process.name, lines);
  }
}

export const pm2Manager = new PM2Manager();