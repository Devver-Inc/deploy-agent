import { existsSync } from "fs";
import { dirname } from "path";
import { exec, execOrThrow } from "../../utils/exec";
import { ensureDir } from "../../utils/fs";

export class GitWorktreeOperations {
  async createCandidateWorktree(
    repoPath: string,
    candidatePath: string,
    ref: string,
  ): Promise<void> {
    ensureDir(dirname(candidatePath));
    await execOrThrow(
      `git worktree add --detach "${candidatePath}" -- "${ref}"`,
      repoPath,
    );
    await execOrThrow(`chown -R deploy:deploy "${candidatePath}"`);
    await execOrThrow(`chmod -R u+rwX "${candidatePath}"`);
  }

  async promoteCandidateWorktree(
    repoPath: string,
    activePath: string,
    candidatePath: string,
    backupPath: string,
  ): Promise<void> {
    const hadActiveWorktree = existsSync(activePath);
    ensureDir(dirname(backupPath));

    if (hadActiveWorktree) {
      await execOrThrow(
        `git worktree move "${activePath}" "${backupPath}"`,
        repoPath,
      );
    }

    try {
      await execOrThrow(
        `git worktree move "${candidatePath}" "${activePath}"`,
        repoPath,
      );
    } catch (error) {
      if (hadActiveWorktree && existsSync(backupPath)) {
        await execOrThrow(
          `git worktree move "${backupPath}" "${activePath}"`,
          repoPath,
        );
      }
      throw error;
    }
  }

  async rollbackPromotion(
    repoPath: string,
    activePath: string,
    backupPath: string,
  ): Promise<void> {
    await this.removeWorktree(repoPath, activePath);
    if (existsSync(backupPath)) {
      await execOrThrow(
        `git worktree move "${backupPath}" "${activePath}"`,
        repoPath,
      );
    }
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
    if (!result.success) {
      throw new Error(`Failed to list Git worktrees: ${result.stderr}`);
    }

    const prefix = `worktree ${deploymentsPath}/`;
    return result.stdout
      .split("\n")
      .filter((line) => line.startsWith(prefix))
      .map((line) => line.slice(prefix.length))
      .filter((branch) => branch && !branch.startsWith(".releases/"));
  }

  async getCurrentCommit(worktreePath: string): Promise<string> {
    return (await execOrThrow("git rev-parse HEAD", worktreePath)).trim();
  }
}
