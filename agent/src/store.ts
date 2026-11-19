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
  envHash?: string;
  startedAt: string;
}

function load<T>(path: string): Record<string, T> {
  if (!existsSync(path)) return {};
  return JSON.parse(readFileSync(path, "utf8"));
}

function save(path: string, data: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, JSON.stringify(data, null, 2), { mode: 0o600 });
  renameSync(tmp, path);
}

let releases = load<Release>(config.paths.store);
/** Stable hosts (a branch's latest deployment of a service) → deployment id; the backend owns the table. */
let aliases = load<string>(config.paths.aliases);

export const store = {
  get: (id: string): Release | undefined => releases[id],
  all: (): Release[] => Object.values(releases),
  byHost: (host: string) => releases[aliases[host] ?? ""] ?? Object.values(releases).find((r) => r.host === host),
  set(release: Release): void {
    releases = { ...releases, [release.id]: release };
    save(config.paths.store, releases);
  },
  delete(id: string): void {
    const { [id]: _, ...rest } = releases;
    releases = rest;
    save(config.paths.store, releases);
  },
  aliases: (): Record<string, string> => aliases,
  setAliases(table: Record<string, string>): void {
    aliases = table;
    save(config.paths.aliases, aliases);
  },
};
