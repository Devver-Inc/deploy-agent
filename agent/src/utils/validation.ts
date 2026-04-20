const REPO_NAME_REGEX = /^[a-z0-9-]+$/;
const BRANCH_REGEX =
  /^(?!\/)(?!.*\.\.)(?!.*\/\/)(?!.*\s)[A-Za-z0-9._\/-]{1,120}$/;
const COMMIT_REGEX = /^[0-9a-fA-F]{7,40}$/;
const PM2_PROCESS_REGEX = /^[A-Za-z0-9._-]+$/;
const DEPLOYMENT_ID_REGEX = /^[a-z0-9][a-z0-9-]{0,62}$/;
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const SLUG_REGEX = /^[a-z0-9][a-z0-9-]{0,62}$/;
const ENV_KEY_REGEX = /^[A-Z_][A-Z0-9_]*$/i;
const URI_REGEX = /^https:\/\//;
const MAX_STRING_LENGTH = 512;

export const REPO_NAME_PATTERN = "^[a-z0-9-]+$";
export const BRANCH_PATTERN =
  "^(?!/)(?!.*\\.\\.)(?!.*//)(?!.*\\s)[A-Za-z0-9._/-]{1,120}$";
export const COMMIT_PATTERN = "^[0-9a-fA-F]{7,40}$";
export const PM2_PROCESS_PATTERN = "^[A-Za-z0-9._-]+$";
export const DEPLOYMENT_ID_PATTERN = "^[a-z0-9][a-z0-9-]{0,62}$";
export const PROJECT_ID_PATTERN = "^[a-z0-9-]+$";
export const ORGANIZATION_ID_PATTERN = UUID_REGEX.source + "|" + SLUG_REGEX.source;
export const ENV_KEY_PATTERN = "^[A-Z_][A-Z0-9_]*$";
export const MAX_LENGTH = MAX_STRING_LENGTH;

export function isValidDeploymentId(id: string): boolean {
  return DEPLOYMENT_ID_REGEX.test(id);
}

export function isValidProjectId(id: string): boolean {
  return REPO_NAME_REGEX.test(id) || UUID_REGEX.test(id);
}

export function isValidOrganizationId(id: string): boolean {
  return UUID_REGEX.test(id) || SLUG_REGEX.test(id);
}

export function isValidEnvKey(key: string): boolean {
  return ENV_KEY_REGEX.test(key);
}

export function isValidUri(uri: string): boolean {
  return URI_REGEX.test(uri);
}

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
