export function safeBranch(branch: string): string {
  return branch.replace(/\//g, "-").toLowerCase();
}
