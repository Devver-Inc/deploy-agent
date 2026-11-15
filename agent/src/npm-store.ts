import { createHash } from "crypto";
import { existsSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "fs";
import { dirname, join, posix } from "path";
import { config } from "./config";
import { run } from "./utils/exec";

// Each installed package is kept once, by integrity; a new lockfile starts from
// hardlinks to the ones it shares, so npm only installs the rest.
export const STORE = "npm-store";

// The lockfile comes from the user: its paths become shell arguments.
const PATH = /^node_modules\/(?:@[\w.-]+\/)?[\w.-]+(?:\/node_modules\/(?:@[\w.-]+\/)?[\w.-]+)*$/;
const BIN_NAME = /^[\w.@-]+$/;
const BIN_FILE = /^(?!\/)(?!.*(?:^|\/)\.\.(?:\/|$))[\w.@/-]+$/;

interface Entry {
  path: string;
  key: string;
  bins: [string, string][];
}

const q = (s: string) => `'${s.replaceAll("'", `'\\''`)}'`;

export function lockEntries(servicePath: string): Entry[] {
  let lock: { lockfileVersion?: number; packages?: Record<string, any> };
  try {
    lock = JSON.parse(readFileSync(join(servicePath, "package-lock.json"), "utf8"));
  } catch {
    return [];
  }
  const packages = Object.entries(lock.packages ?? {});
  // Stripping a package's nested node_modules would drop its bundled deps.
  const bundling = new Set(
    packages.filter(([, e]) => e?.inBundle).map(([p]) => p.slice(0, p.lastIndexOf("/node_modules/"))),
  );
  return packages
    .filter(([p, e]) => PATH.test(p) && typeof e?.integrity === "string" && !e.link && !e.inBundle && !bundling.has(p))
    .map(([path, e]) => {
      const bin = typeof e.bin === "string" ? { [path.split("/").pop()!]: e.bin } : (e.bin ?? {});
      return {
        path,
        key: createHash("sha256").update(e.integrity).digest("hex"),
        bins: Object.entries(bin as Record<string, unknown>).filter(
          (b): b is [string, string] => BIN_NAME.test(b[0]) && typeof b[1] === "string" && BIN_FILE.test(b[1]),
        ),
      };
    })
    .sort((a, b) => a.path.length - b.path.length);
}

export function seedScript(servicePath: string, store: string, entries: Entry[]): string {
  const lines = ["set -e"];
  for (const { path, key, bins } of entries) {
    const target = join(servicePath, path);
    lines.push(`mkdir -p ${q(dirname(target))}`, `cp -al ${q(join(store, key))} ${q(target)}`);
    // Without its .bin links npm treats a package as broken and unpacks it again.
    const binDir = join(servicePath, path.slice(0, path.lastIndexOf("node_modules/") + "node_modules".length), ".bin");
    for (const [name, file] of bins) {
      lines.push(`mkdir -p ${q(binDir)}`, `ln -sfn ${q(posix.relative(binDir, join(target, file)))} ${q(join(binDir, name))}`);
    }
  }
  return lines.join("\n");
}

async function runAsDeploy(script: string): Promise<void> {
  // A big lockfile does not fit in one argv string.
  const file = join(config.paths.caches, `.${STORE}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}.sh`);
  writeFileSync(file, script, { mode: 0o644 });
  try {
    const result = await run(["/bin/sh", file], { user: "deploy" });
    if (!result.ok) console.error(`npm store: ${result.stderr.trim()}`);
  } finally {
    rmSync(file, { force: true });
  }
}

export async function seed(servicePath: string, store = join(config.paths.caches, STORE)): Promise<number> {
  if (existsSync(join(servicePath, "node_modules"))) return 0;
  const found = lockEntries(servicePath).filter((e) => existsSync(join(store, e.key)));
  if (found.length) await runAsDeploy(seedScript(servicePath, store, found));
  return found.length;
}

export async function ingest(servicePath: string, store = join(config.paths.caches, STORE)): Promise<void> {
  const suffix = `.tmp-${Date.now().toString(36)}`;
  const fresh = [...new Map(lockEntries(servicePath).map((e) => [e.key, e])).values()].filter(
    (e) => !existsSync(join(store, e.key)) && existsSync(join(servicePath, e.path, "package.json")),
  );
  if (!fresh.length) return;
  const lines = [`mkdir -p ${q(store)}`];
  for (const { path, key } of fresh) {
    const tmp = join(store, key + suffix);
    lines.push(`cp -al ${q(join(servicePath, path))} ${q(tmp)} && rm -rf ${q(join(tmp, "node_modules"))}`);
  }
  await runAsDeploy(lines.join("\n"));
  for (const { key } of fresh) {
    try {
      renameSync(join(store, key + suffix), join(store, key));
    } catch {
      rmSync(join(store, key + suffix), { recursive: true, force: true });
    }
  }
}

// nlink 1: only the store still links the package.
export function pruneStore(store: string): void {
  if (!existsSync(store)) return;
  for (const name of readdirSync(store)) {
    if (!/^[0-9a-f]{64}$/.test(name)) continue;
    let nlink = 0;
    try {
      nlink = statSync(join(store, name, "package.json")).nlink;
    } catch {}
    if (nlink <= 1) rmSync(join(store, name), { recursive: true, force: true });
  }
}
