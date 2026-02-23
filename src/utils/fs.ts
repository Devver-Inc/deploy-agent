import { mkdirSync } from "fs";

export function ensureDir(path: string): void {
  mkdirSync(path, { recursive: true });
}
