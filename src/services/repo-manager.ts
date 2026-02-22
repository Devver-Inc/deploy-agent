import { existsSync, writeFileSync } from "fs";
import { execOrThrow } from "../utils/exec";
import { ensureDir } from "../utils/fs";
import { JsonRegistry } from "../utils/registry";

const REPOS_BASE = "/app/repos";

export interface RepoConfig {
  name: string;
  baseUrl: string;
  createdAt: string;
}

export interface ReposRegistry {
  [name: string]: RepoConfig;
}

export class RepoManager {
  private registry = new JsonRegistry<ReposRegistry>("/app/data/repos.json", {});

  constructor() {
    ensureDir(REPOS_BASE);
  }

  getRepoPath(name: string): string {
    return `${REPOS_BASE}/${name}.git`;
  }

  exists(name: string): boolean {
    return existsSync(this.getRepoPath(name));
  }

  async create(name: string, baseUrl: string): Promise<void> {
    const repoPath = this.getRepoPath(name);
    if (existsSync(repoPath)) throw new Error(`Repo '${name}' already exists`);

    ensureDir(repoPath);
    await execOrThrow("git init --bare", repoPath);
    await execOrThrow(`git config receive.denyCurrentBranch ignore`, repoPath);
    await execOrThrow(`git config receive.denyNonFastForwards false`, repoPath);
    await execOrThrow(`git config http.receivepack true`, repoPath);
    await execOrThrow(`git config --global --add safe.directory ${repoPath}`);
    await execOrThrow(`git config --global --add safe.directory '/app/deployments/${name}/*'`);

    writeFileSync(`${repoPath}/hooks/post-receive`, this.generatePostReceiveHook(name));
    await execOrThrow(`chmod +x ${repoPath}/hooks/post-receive`, repoPath);
    await execOrThrow(`chown -R git:git ${repoPath}`);

    this.registry.set(name, { name, baseUrl, createdAt: new Date().toISOString() });
  }

  private generatePostReceiveHook(repoName: string): string {
    return `#!/bin/bash
DEPLOYMENTS_DIR="/app/deployments/${repoName}"
while read oldrev newrev refname; do
    branch=\$(echo "\$refname" | sed 's|refs/heads/||')
    worktree_path="\$DEPLOYMENTS_DIR/\$branch"
    if [ -d "\$worktree_path" ]; then
        cd "\$worktree_path"
        git fetch --all --prune 2>&1 || true
        git reset --hard "\$newrev" 2>&1
        git clean -fd 2>&1 || true
    fi
done
`;
  }

  async delete(name: string): Promise<void> {
    const repoPath = this.getRepoPath(name);
    if (!existsSync(repoPath)) return;
    await execOrThrow(`rm -rf ${repoPath}`);
    this.registry.remove(name);
  }

  list(): RepoConfig[] {
    return Object.values(this.registry.entries);
  }

  getPushUrl(name: string): string {
    const config = this.registry.entries[name];
    const baseUrl = config?.baseUrl ?? "http://localhost";
    return `${baseUrl}/git/${name}.git`;
  }
}

export const repoManager = new RepoManager();
