import { isAbsolute, relative, resolve, sep } from "path";

export function resolvePathWithin(basePath: string, requestedPath = "."): string {
  const resolvedBase = resolve(basePath);
  const resolvedPath = resolve(resolvedBase, requestedPath);
  const relativePath = relative(resolvedBase, resolvedPath);

  if (
    relativePath === ".." ||
    relativePath.startsWith(`..${sep}`) ||
    isAbsolute(relativePath)
  ) {
    throw new Error("Path must stay inside the deployment worktree.");
  }

  return resolvedPath;
}
