const REPO_NAME_REGEX = /^[a-z0-9-]+$/;
const BRANCH_REGEX =
  /^(?!\/)(?!.*\.\.)(?!.*\/\/)(?!.*\s)[A-Za-z0-9._\/-]{1,120}$/;
const COMMIT_REGEX = /^[0-9a-fA-F]{7,40}$/;
const PM2_PROCESS_REGEX = /^[A-Za-z0-9._-]+$/;

export const REPO_NAME_PATTERN = "^[a-z0-9-]+$";
export const BRANCH_PATTERN =
  "^(?!/)(?!.*\\.\\.)(?!.*//)(?!.*\\s)[A-Za-z0-9._/-]{1,120}$";
export const COMMIT_PATTERN = "^[0-9a-fA-F]{7,40}$";
export const PM2_PROCESS_PATTERN = "^[A-Za-z0-9._-]+$";

export function isValidRepoName(repo: string): boolean {
  return REPO_NAME_REGEX.test(repo);
}

export function isValidBranch(branch: string): boolean {
  return BRANCH_REGEX.test(branch);
}

export function isValidCommit(commit: string): boolean {
  return COMMIT_REGEX.test(commit);
}

export function isValidPm2ProcessName(name: string): boolean {
  return PM2_PROCESS_REGEX.test(name);
}

export function assertSafeShellCommand(command: string): void {
  const allowUnsafe = process.env.DEVVER_ALLOW_UNSAFE_COMMANDS === "true";
  if (allowUnsafe) return;

  const blockedPatterns = [/&&/, /\|\|/, /(?<!\|)\|(?!\|)/, /;/, /`/, /\$\(/, /[<>]/, /\r|\n/];
  if (blockedPatterns.some((pattern) => pattern.test(command))) {
    throw new Error(
      "Command contains potentially unsafe shell tokens. Set DEVVER_ALLOW_UNSAFE_COMMANDS=true to bypass.",
    );
  }
}
