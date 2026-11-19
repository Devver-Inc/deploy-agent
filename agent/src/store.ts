import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "fs";
import { dirname } from "path";
import type { ServiceSpec } from "./contract";
import { config } from "./config";

export interface Release {
  id: string;
  repo: string;
  ref: string;
  commit: string;
  host: string;
  /** Stable hosts (a branch URL) also served by this deployment; one deployment holds each. */
  aliases?: string[];
  service: ServiceSpec;
  release: string;
  port: number;
  lockHash?: string;
  envHash?: string;
  startedAt: string;
}

function load(): Record<string, Release> {
  if (!existsSync(config.paths.store)) return {};
  return JSON.parse(readFileSync(config.paths.store, "utf8"));
}

let releases = load();

function save(): void {
  mkdirSync(dirname(config.paths.store), { recursive: true });
  const tmp = `${config.paths.store}.tmp`;
  writeFileSync(tmp, JSON.stringify(releases, null, 2), { mode: 0o600 });
  renameSync(tmp, config.paths.store);
}

/** The release keeps its aliases; any other deployment holding one of them gives it up. */
export function withRelease(all: Record<string, Release>, release: Release): Record<string, Release> {
  const taken = new Set(release.aliases ?? []);
  const others = Object.values(all)
    .filter((r) => r.id !== release.id)
    .map((r) => (r.aliases?.some((a) => taken.has(a)) ? { ...r, aliases: r.aliases.filter((a) => !taken.has(a)) } : r));
  return Object.fromEntries([...others, release].map((r) => [r.id, r]));
}

export const store = {
  get: (id: string): Release | undefined => releases[id],
  all: (): Release[] => Object.values(releases),
  byHost: (host: string) => Object.values(releases).find((r) => r.host === host || r.aliases?.includes(host)),
  set(release: Release): void {
    releases = withRelease(releases, release);
    save();
  },
  delete(id: string): void {
    const { [id]: _, ...rest } = releases;
    releases = rest;
    save();
  },
};
