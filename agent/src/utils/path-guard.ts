import { DeployError } from "./errors";

const SAFE_FILENAME_PATTERN = /^[A-Za-z0-9._-]+$/;
const PATH_SEGMENT_PATTERN = /^[A-Za-z0-9._-]+$/;
const NULL_BYTE = /\0/g;

export function toSafeFilename(name: string): string {
  const sanitized = name.replace(/[^A-Za-z0-9._-]/g, "_");

  if (!sanitized || sanitized === "." || sanitized === "..") {
    return "_";
  }

  return sanitized;
}

export function assertSafeFilename(name: string): void {
  if (NULL_BYTE.test(name)) {
    throw DeployError.validation("Filename contains null byte", { name });
  }

  if (!SAFE_FILENAME_PATTERN.test(name)) {
    throw DeployError.validation("Filename contains unsafe characters", { name, pattern: "[A-Za-z0-9._-]" });
  }

  if (name === "." || name === "..") {
    throw DeployError.validation("Filename cannot be . or ..", { name });
  }
}

export function safeJoin(root: string, ...segments: string[]): string {
  const cleaned = segments
    .filter(s => s !== "")
    .map(s => s.replace(/^\/+|\/+$/g, ""))
    .filter(s => s !== "");

  const path = [root, ...cleaned].join("/");

  for (const segment of cleaned) {
    if (PATH_SEGMENT_PATTERN.test(segment) === false) {
      throw DeployError.validation("Invalid path segment", { segment });
    }
  }

  return path.replace(/\/+/g, "/");
}

export function assertWithin(root: string, target: string): void {
  const resolvedTarget = target.replace(/^\/./, "");
  const resolvedRoot = root.replace(/^\/./, "");

  if (resolvedTarget.includes("..")) {
    throw DeployError.validation("Path traversal attempt detected", { root, target });
  }

  if (!resolvedTarget.startsWith(resolvedRoot) && !resolvedTarget.startsWith("./" + resolvedRoot)) {
    throw DeployError.validation("Path escapes root directory", { root, target });
  }
}