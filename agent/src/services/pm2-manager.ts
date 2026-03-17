import { writeFileSync } from "fs";
import { exec, execOrThrow } from "../utils/exec";
import { ensureDir } from "../utils/fs";
import type { PM2Process, LogEntry } from "../types";
import { buildProcessName, matchesProcess, matchesDeployment } from "./pm2/pm2-process-name";
import { parsePm2Logs } from "./pm2/pm2-log-parser";
import { config } from "../config";
import { pollUntil } from "../utils/poll-until";

export { matchesDeployment };

export class PM2Manager {
  async start(
    service: string,
    branch: string,
    port: number,
    startCommand: string,
    cwd: string,
    env: Record<string, string> = {},
  ): Promise<string> {
    const name = buildProcessName(service, branch, port);

    const existing = (await this.list()).filter((p) =>
      matchesProcess(p.name, service, branch),
    );
    await Promise.all(existing.map((p) => this.delete(p.name)));

    const envVars = { ...env, PORT: port.toString(), HOST: "0.0.0.0" };
    ensureDir(config.paths.pm2Data);
    const ecosystemFile = `${config.paths.pm2Data}/${name}.config.js`;
    const wrapperScript = `${config.paths.pm2Data}/${name}.sh`;

    writeFileSync(
      ecosystemFile,
      `module.exports = {
  apps: [{
    name: "${name}",
    script: "${wrapperScript}",
    cwd: "${cwd}",
    interpreter: "/bin/sh",
    env: ${JSON.stringify(envVars)},
    watch: false,
    autorestart: true,
    max_restarts: 5,
  }]
};`,
    );

    writeFileSync(
      wrapperScript,
      `#!/bin/sh\ncd "${cwd}"\nexec ${startCommand}\n`,
    );
    await execOrThrow(`chmod +x ${wrapperScript}`, cwd);
    await execOrThrow(`pm2 start ${ecosystemFile}`, cwd);
    await this.waitForProcess(name);
    await exec("pm2 save");

    return name;
  }

  async waitForProcess(name: string, timeoutMs = 30000): Promise<void> {
    await pollUntil(
      async () => {
        const proc = (await this.list()).find((p) => p.name === name);
        if (proc?.status === "errored") {
          throw new Error(`Process ${name} failed:\n${await this.getLogs(name, 20)}`);
        }
        return proc?.status === "online";
      },
      timeoutMs,
      `Process ${name} timed out after ${timeoutMs}ms`,
    );
  }

  async stop(name: string): Promise<void> {
    await execOrThrow(`pm2 stop ${name}`);
    await exec("pm2 save");
  }

  async startExisting(name: string): Promise<void> {
    await execOrThrow(`pm2 start ${name}`);
    await this.waitForProcess(name);
    await exec("pm2 save");
  }

  async restart(name: string): Promise<void> {
    await execOrThrow(`pm2 restart ${name} --update-env`);
    await this.waitForProcess(name);
    await exec("pm2 save");
  }

  async delete(name: string): Promise<void> {
    await exec(`pm2 delete ${name}`);
    await exec("pm2 save");
  }

  async deleteByBranch(branch: string): Promise<void> {
    const processes = await this.list();
    for (const proc of processes) {
      if (matchesDeployment(proc.name, branch)) await this.delete(proc.name);
    }
  }

  async reload(name: string): Promise<void> {
    await execOrThrow(`pm2 reload ${name} --update-env`);
  }

  async processExists(name: string): Promise<boolean> {
    return (await exec(`pm2 describe ${name}`)).success;
  }

  async list(): Promise<PM2Process[]> {
    const result = await exec("pm2 jlist");
    if (!result.success) return [];
    try {
      return JSON.parse(result.stdout).map((p: any) => ({
        name: p.name,
        pm_id: p.pm_id,
        status: p.pm2_env?.status ?? "stopped",
        cpu: p.monit?.cpu ?? 0,
        memory: p.monit?.memory ?? 0,
      }));
    } catch {
      return [];
    }
  }

  async getLogs(name: string, lines = 100): Promise<string> {
    const result = await exec(`pm2 logs ${name} --nostream --lines ${lines}`);
    return result.stdout + result.stderr;
  }

  async getLogsByDeployment(
    deploymentId: string,
    lines = 50,
  ): Promise<LogEntry[]> {
    const processes = await this.list();
    const matching = processes.filter((p) => matchesDeployment(p.name, deploymentId));

    const logs: LogEntry[] = [];
    for (const proc of matching) {
      const raw = await this.getLogs(proc.name, lines);
      logs.push(...parsePm2Logs(deploymentId, proc.name, raw));
    }
    return logs;
  }
}

export const pm2Manager = new PM2Manager();
