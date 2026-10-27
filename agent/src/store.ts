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
  service: ServiceSpec;
  release: string;
  port: number;
  lockHash?: string;
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

export const store = {
  get: (id: string): Release | undefined => releases[id],
  all: (): Release[] => Object.values(releases),
  byHost: (host: string) => Object.values(releases).find((r) => r.host === host),
  set(release: Release): void {
    releases = { ...releases, [release.id]: release };
    save();
  },
  delete(id: string): void {
    const { [id]: _, ...rest } = releases;
    releases = rest;
    save();
  },
};
