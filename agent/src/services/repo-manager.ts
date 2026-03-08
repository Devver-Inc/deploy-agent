import { existsSync, writeFileSync } from "fs";
import { rm } from "fs/promises";
import { execOrThrow } from "../utils/exec";
import { ensureDir } from "../utils/fs";
import { isValidRepoName } from "../utils/validation";
import { buildPostReceiveHook } from "./repo/repo-hook-template";
import { assertRepoPathWithinBase } from "./repo/repo-path-guard";
import { JsonRepoRepository } from "./repo/json-repo-repository";
import type { RepoConfig, RepoRepository } from "./repo/repo-repository";
import type { CreateRepoRequest } from "../types";

const REPOS_BASE = "/app/repos";

export class RepoManager {
  constructor(private repository: RepoRepository = new JsonRepoRepository()) {
    ensureDir(REPOS_BASE);
  }

  getRepoPath(name: string): string {
    return `${REPOS_BASE}/${name}.git`;
  }

  exists(name: string): boolean {
    return existsSync(this.getRepoPath(name));
  }

  async create({ name, baseUrl }: CreateRepoRequest): Promise<void> {
    if (!isValidRepoName(name)) {
      throw new Error("Invalid repository name.");
    }

    const repoPath = this.getRepoPath(name);
    if (existsSync(repoPath)) throw new Error(`Repo '${name}' already exists`);

    ensureDir(repoPath);
    await execOrThrow("git init --bare", repoPath);
    await execOrThrow(`git config receive.denyCurrentBranch ignore`, repoPath);
    await execOrThrow(`git config receive.denyNonFastForwards false`, repoPath);
    await execOrThrow(`git config http.receivepack true`, repoPath);
    await execOrThrow(`git config --global --add safe.directory ${repoPath}`);
    await execOrThrow(
      `git config --global --add safe.directory '/app/deployments/${name}/*'`,
    );

    writeFileSync(`${repoPath}/hooks/post-receive`, buildPostReceiveHook(name));
    await execOrThrow(`chmod +x ${repoPath}/hooks/post-receive`, repoPath);
    await execOrThrow(`chown -R git:git ${repoPath}`);

    this.repository.set(name, {
      name,
      baseUrl,
      createdAt: new Date().toISOString(),
    });
  }

  async delete(name: string): Promise<void> {
    if (!isValidRepoName(name)) {
      throw new Error("Invalid repository name.");
    }

    const repoPath = this.getRepoPath(name);
    if (!existsSync(repoPath)) return;

    assertRepoPathWithinBase(REPOS_BASE, repoPath);

    await rm(repoPath, { recursive: true, force: true });
    this.repository.remove(name);
  }

  list(): RepoConfig[] {
    return this.repository.getAll();
  }

  getBaseUrl(name: string): string {
    return this.repository.get(name)?.baseUrl ?? "";
  }

  getPushUrl(name: string): string {
    const config = this.repository.get(name);
    const baseUrl = config?.baseUrl ?? "http://localhost";
    return `${baseUrl}/git/${name}.git`;
  }
}

export const repoManager = new RepoManager();
