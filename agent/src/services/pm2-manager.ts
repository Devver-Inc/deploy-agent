import {
  chmodSync,
  chownSync,
  existsSync,
  readFileSync,
  writeFileSync,
} from "fs";
import { createServer } from "net";
import { exec, execOrThrow } from "../utils/exec";
import { ensureDir } from "../utils/fs";
import type {
  PM2Process,
  LogEntry,
  FileSnapshot,
  ProcessSnapshot,
} from "../types";
import {
  buildProcessName,
  matchesProcess,
  matchesDeployment,
} from "./pm2/pm2-process-name";
import { parsePm2Logs } from "./pm2/pm2-log-parser";
import { config } from "../config";
import { pollUntil } from "../utils/poll-until";

export { matchesDeployment };

const ROOT_UID = 0;
const DEPLOY_GID = 10001;

export class PM2Manager {
  private snapshotFile(path: string): FileSnapshot {
    return existsSync(path)
      ? { path, exists: true, content: readFileSync(path, "utf8") }
      : { path, exists: false };
  }

  async snapshotDeployment(deploymentId: string): Promise<ProcessSnapshot[]> {
    const processes = (await this.list()).filter((process) =>
      matchesDeployment(process.name, deploymentId),
    );

    return processes.map((process) => ({
      name: process.name,
      status: process.status,
      ecosystemFile: this.snapshotFile(
        `${config.paths.pm2Data}/${process.name}.config.js`,
      ),
      wrapperScript: this.snapshotFile(
        `${config.paths.pm2Data}/${process.name}.sh`,
      ),
    }));
  }

  async restoreSnapshots(snapshots: ProcessSnapshot[]): Promise<void> {
    for (const snapshot of snapshots) {
      if (
        !snapshot.ecosystemFile.exists ||
        snapshot.ecosystemFile.content === undefined ||
        !snapshot.wrapperScript.exists ||
        snapshot.wrapperScript.content === undefined
      ) {
        throw new Error(`Incomplete PM2 snapshot for ${snapshot.name}`);
      }

      ensureDir(config.paths.pm2Data);
      writeFileSync(
        snapshot.ecosystemFile.path,
        snapshot.ecosystemFile.content,
        { mode: 0o600 },
      );
      chmodSync(snapshot.ecosystemFile.path, 0o600);
      writeFileSync(
        snapshot.wrapperScript.path,
        snapshot.wrapperScript.content,
      );
      chownSync(snapshot.wrapperScript.path, ROOT_UID, DEPLOY_GID);
      chmodSync(snapshot.wrapperScript.path, 0o750);

      if (snapshot.status === "online" || snapshot.status === "stopped") {
        await execOrThrow(`pm2 start ${snapshot.ecosystemFile.path}`);
        await this.waitForProcess(snapshot.name);
        if (snapshot.status === "stopped") {
          await execOrThrow(`pm2 stop ${snapshot.name}`);
        }
      }
    }
    await exec("pm2 save");
  }

  async start(
    service: string,
    deploymentId: string,
    port: number,
    startCommand: string,
    cwd: string,
    env: Record<string, string> = {},
  ): Promise<string> {
    const name = buildProcessName(service, deploymentId, port);

    const existing = (await this.list()).filter((p) =>
      matchesProcess(p.name, service, deploymentId),
    );
    await Promise.all(existing.map((p) => this.delete(p.name)));

    const stillExisting = (await this.list()).filter((p) =>
      matchesProcess(p.name, service, deploymentId),
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
    const wrapperScript = `${config.paths.pm2Data}/${name}.sh`;

    const ecosystem = {
      apps: [
        {
          name,
          script: wrapperScript,
          cwd,
          interpreter: "/bin/sh",
          uid: "deploy",
          gid: "deploy",
          env: envVars,
          watch: false,
          autorestart: true,
          max_restarts: 5,
          kill_timeout: 5000,
          treekill: true,
        },
      ],
    };
    writeFileSync(
      ecosystemFile,
      `module.exports = ${JSON.stringify(ecosystem, null, 2)};`,
      { mode: 0o600 },
    );

    writeFileSync(wrapperScript, `#!/bin/sh\nexec ${startCommand}\n`, {
      mode: 0o750,
    });
    chownSync(wrapperScript, ROOT_UID, DEPLOY_GID);
    chmodSync(wrapperScript, 0o750);
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
    const pid = await this.getProcessPid(name);
    await execOrThrow(`pm2 delete ${name}`);
    if (pid && pid > 0) {
      await this.killProcessTree(pid);
    }
    await exec("pm2 save");
  }

  async deleteByDeployment(deploymentId: string): Promise<void> {
    const processes = await this.list();
    for (const proc of processes) {
      if (matchesDeployment(proc.name, deploymentId))
        await this.delete(proc.name);
    }
  }

  private async getProcessPid(name: string): Promise<number | undefined> {
    const result = await exec("pm2 jlist");
    if (!result.success) return undefined;
    try {
      const processes = JSON.parse(result.stdout);
      const proc = processes.find((p: any) => p.name === name);
      return proc?.pid > 0 ? proc.pid : undefined;
    } catch {
      return undefined;
    }
  }

  private async killProcessTree(pid: number): Promise<void> {
    // Kill entire process group first, then direct PID as fallback
    await exec(`kill -9 -${pid}`);
    await exec(`kill -9 ${pid}`);
  }

  async killPort(port: number): Promise<void> {
    await exec(`fuser -k ${port}/tcp`);
  }

  private async waitForPortFree(
    port: number,
    timeoutMs = 10000,
  ): Promise<void> {
    await pollUntil(
      async () =>
        new Promise<boolean>((resolve) => {
          const server = createServer();
          server.once("error", () => resolve(false));
          server.once("listening", () => {
            server.close();
            resolve(true);
          });
          server.listen(port, "127.0.0.1");
        }),
      timeoutMs,
      `Port ${port} was not freed within ${timeoutMs}ms`,
    );
  }

  async list(): Promise<PM2Process[]> {
    const result = await exec("pm2 jlist");
    if (!result.success) {
      throw new Error(`Failed to list PM2 processes: ${result.stderr}`);
    }
    try {
      return JSON.parse(result.stdout).map((p: any) => ({
        name: p.name,
        pm_id: p.pm_id,
        status: p.pm2_env?.status ?? "stopped",
        cpu: p.monit?.cpu ?? 0,
        memory: p.monit?.memory ?? 0,
      }));
    } catch (error) {
      throw new Error("PM2 returned an invalid process list.", {
        cause: error,
      });
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
    const matching = processes.filter((p) =>
      matchesDeployment(p.name, deploymentId),
    );

    const logs: LogEntry[] = [];
    for (const proc of matching) {
      const raw = await this.getLogs(proc.name, lines);
      logs.push(...parsePm2Logs(deploymentId, proc.name, raw));
    }
    return logs;
  }
}

export const pm2Manager = new PM2Manager();
