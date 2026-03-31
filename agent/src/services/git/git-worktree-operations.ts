import { existsSync } from "fs";
import { exec, execOrThrow } from "../../utils/exec";
import { ensureDir } from "../../utils/fs";

export class GitWorktreeOperations {
  worktreeExists(worktreePath: string): boolean {
    return existsSync(worktreePath);
  }

  async createWorktree(
    repoPath: string,
    deploymentsPath: string,
    worktreePath: string,
    branch: string,
    commit?: string,
  ): Promise<void> {
    ensureDir(deploymentsPath);
    await execOrThrow(
      `git worktree add "${worktreePath}" ${commit ?? branch}`,
      repoPath,
    );
  }

  async updateWorktree(
    repoPath: string,
    worktreePath: string,
    branch: string,
    commit?: string,
  ): Promise<void> {
    await execOrThrow(
      `git fetch "${repoPath}" ${branch}`,
      worktreePath,
    );
    const latestCommit = commit ?? (await execOrThrow(`git rev-parse FETCH_HEAD`, worktreePath)).trim();
    await execOrThrow(`git reset --hard ${latestCommit}`, worktreePath);
    await execOrThrow("git clean -fdx --exclude=node_modules", worktreePath);
  }

  async removeWorktree(repoPath: string, worktreePath: string): Promise<void> {
    if (!existsSync(worktreePath)) return;
    await execOrThrow(
      `git worktree remove "${worktreePath}" --force`,
      repoPath,
    );
  }

  async listWorktrees(
    repoPath: string,
    deploymentsPath: string,
  ): Promise<string[]> {
    const result = await exec("git worktree list --porcelain", repoPath);
    if (!result.success) return [];

    const worktrees: string[] = [];
    for (const line of result.stdout.split("\n")) {
      if (line.startsWith("worktree ") && line.includes(deploymentsPath)) {
        const path = line.replace("worktree ", "");
        const branch = path.split(`${deploymentsPath}/`)[1];
        if (branch) worktrees.push(branch);
      }
    }
    return worktrees;
  }

  async getCurrentCommit(worktreePath: string): Promise<string> {
    return (await execOrThrow("git rev-parse HEAD", worktreePath)).trim();
  }
}
