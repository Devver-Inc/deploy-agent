import { resolve } from "path";

export function assertRepoPathWithinBase(
  basePath: string,
  targetPath: string,
): void {
  const base = resolve(basePath);
  const target = resolve(targetPath);
  if (!target.startsWith(`${base}/`) || !target.endsWith(".git")) {
    throw new Error("Refusing to delete path outside repositories base.");
  }
}
