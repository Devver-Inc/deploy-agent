import { expect, test } from "bun:test";
import { linkSync, mkdirSync, mkdtempSync, readdirSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { HOST_PATTERN, ID_PATTERN, REF_PATTERN } from "./contract";
import { envHash, lockHash, pruneShared } from "./deploy";
import { routesMap, widgetConf } from "./nginx";
import { findApps, parsePush } from "./first-push";
import { lockEntries, pruneStore, seedScript } from "./npm-store";
import { wrapperScript } from "./pm2";
import { run, userEnv } from "./utils/exec";
import { resolvePathWithin } from "./utils/validation";
import { resolveRuntime } from "./runtime";

test("user commands never see the agent's env", async () => {
  process.env.DEVVER_SECRET = "leak";
  expect(userEnv({ NODE_ENV: "x" })).not.toHaveProperty("DEVVER_SECRET");

  const env = userEnv({ PORT: "3000" });
  const start = await run(["/bin/sh", "-c", wrapperScript(`echo "it's $PORT"; env`, env)], {
    env: { ...env, DEVVER_SECRET: "leak" },
  });
  expect(start.stdout).toContain("it's 3000");
  expect(start.stdout).not.toContain("DEVVER_SECRET");
});

test("the widget URL cannot break out of the nginx directive", () => {
  const conf = widgetConf(`https://cdn/x.js'; } location / { alias /app/data; } $host"`);
  // Exactly the 4 delimiting quotes of `sub_filter '</body>' '...'` remain.
  expect(conf.match(/'/g)).toHaveLength(4);
  expect(conf).not.toContain("$");
  expect(widgetConf("")).toBe("");
});

test("routes map one host per line", () => {
  expect(routesMap([{ host: "a--p.preview.dev", port: 4100 }])).toBe(
    "a--p.preview.dev 127.0.0.1:4100;\n",
  );
});

test("contract patterns accept backend ids and hosts, reject injection", () => {
  const re = (p: string) => new RegExp(p);
  expect(re(ID_PATTERN).test("app-main-web")).toBe(true);
  expect(re(ID_PATTERN).test("../x")).toBe(false);
  expect(re(HOST_PATTERN).test("app-main--65f0c0ffee00000000000abc.preview.devver.app")).toBe(true);
  expect(re(HOST_PATTERN).test("a b.dev")).toBe(false);
  expect(re(HOST_PATTERN).test("x.dev;}")).toBe(false);
  expect(re(REF_PATTERN).test("feat/x")).toBe(true);
  expect(re(REF_PATTERN).test("--upload-pack=x")).toBe(false);
});

test("lock hash follows the lockfile, so unchanged deps are reused", () => {
  const dir = mkdtempSync(join(tmpdir(), "lock-"));
  writeFileSync(join(dir, "bun.lock"), "a");
  const before = lockHash(dir);
  expect(lockHash(dir)).toBe(before);
  writeFileSync(join(dir, "bun.lock"), "b");
  expect(lockHash(dir)).not.toBe(before);
  expect(lockHash(dir, "web")).not.toBe(lockHash(dir, "api"));
});

test("service.root stays inside the release", () => {
  expect(resolvePathWithin("/app/deployments/x/r", "web")).toBe("/app/deployments/x/r/web");
  expect(() => resolvePathWithin("/app/deployments/x/r", "../../y")).toThrow();
});

test("an env change is a new deployment, key order is not", () => {
  expect(envHash({ A: "1", B: "2" })).toBe(envHash({ B: "2", A: "1" }));
  expect(envHash({ A: "1" })).not.toBe(envHash({ A: "2" }));
  expect(envHash(undefined)).toBe(envHash({}));
});

test("branches with the same lockfile share one dependency folder", () => {
  const branch = (name: string) => {
    const dir = mkdtempSync(join(tmpdir(), `${name}-`));
    writeFileSync(join(dir, "package-lock.json"), '{"react":"19.0.0"}');
    return dir;
  };
  expect(lockHash(branch("main"))).toBe(lockHash(branch("feat-x")));
});

test("pruning keeps hashes in use and folders still being published", () => {
  const root = mkdtempSync(join(tmpdir(), "caches-"));
  const used = "a".repeat(64), unused = "b".repeat(64), publishing = `${"c".repeat(64)}.tmp-x`;
  for (const name of [used, unused, publishing]) mkdirSync(join(root, "node_modules", name), { recursive: true });
  mkdirSync(join(root, "venvs", unused), { recursive: true });
  pruneShared(new Set([used]), root);
  expect(readdirSync(join(root, "node_modules")).sort()).toEqual([used, publishing].sort());
  expect(readdirSync(join(root, "venvs"))).toEqual([]);
});

test("only dependency changes alter the lock hash", () => {
  const project = (pkg: object, lock: object) => {
    const dir = mkdtempSync(join(tmpdir(), "deps-"));
    writeFileSync(join(dir, "package.json"), JSON.stringify(pkg));
    writeFileSync(join(dir, "package-lock.json"), JSON.stringify(lock));
    return lockHash(dir);
  };
  const lock = (version: string, ms = "2.1.3") => ({
    name: "app", version, lockfileVersion: 3,
    packages: { "": { name: "app", version, dependencies: { ms } }, "node_modules/ms": { version: ms } },
  });
  const base = project({ name: "app", version: "1.0.0", scripts: { start: "node ." }, dependencies: { ms: "2.1.3" } }, lock("1.0.0"));
  const scriptAndVersion = project({ name: "app", version: "1.1.0", scripts: { start: "node .", runX: "x" }, dependencies: { ms: "2.1.3" } }, lock("1.1.0"));
  const newDependency = project({ name: "app", version: "1.0.0", scripts: { start: "node ." }, dependencies: { ms: "2.1.2" } }, lock("1.0.0", "2.1.2"));
  expect(scriptAndVersion).toBe(base);
  expect(newDependency).not.toBe(base);
});

test("the npm store seeds lockfile packages by integrity and rejects paths that escape", () => {
  const dir = mkdtempSync(join(tmpdir(), "store-"));
  writeFileSync(join(dir, "package-lock.json"), JSON.stringify({
    lockfileVersion: 3,
    packages: {
      "": { name: "app" },
      "node_modules/@scope/tool": { integrity: "sha512-a", bin: { tool: "bin/tool.js", "../x": "y" } },
      "node_modules/@scope/tool/node_modules/dep": { integrity: "sha512-b" },
      "node_modules/../../etc": { integrity: "sha512-c" },
      "node_modules/evil": { integrity: "sha512-d", bin: { evil: "../../../etc/passwd" } },
      "node_modules/bundler": { integrity: "sha512-e" },
      "node_modules/bundler/node_modules/inner": { inBundle: true },
    },
  }));
  const entries = lockEntries(dir);
  expect(entries.map((e) => e.path)).toEqual([
    "node_modules/evil", "node_modules/@scope/tool", "node_modules/@scope/tool/node_modules/dep",
  ]);
  expect(entries.find((e) => e.path === "node_modules/evil")!.bins).toEqual([]);
  const script = seedScript("/r", "/s", entries);
  expect(script).toContain("ln -sfn '../@scope/tool/bin/tool.js' '/r/node_modules/.bin/tool'");
  expect(script).not.toContain("etc");
});

test("store packages linked from no release are pruned", () => {
  const root = mkdtempSync(join(tmpdir(), "caches-"));
  const store = join(root, "npm-store"), used = join(store, "a".repeat(64)), unused = join(store, "b".repeat(64));
  for (const pkg of [used, unused]) {
    mkdirSync(pkg, { recursive: true });
    writeFileSync(join(pkg, "package.json"), "{}");
  }
  mkdirSync(join(root, "release"));
  linkSync(join(used, "package.json"), join(root, "release", "package.json"));
  pruneStore(store);
  expect(readdirSync(store)).toEqual(["a".repeat(64)]);
});

test("pnpm projects install with their own lockfile", () => {
  const dir = mkdtempSync(join(tmpdir(), "pnpm-"));
  writeFileSync(join(dir, "package.json"), JSON.stringify({ scripts: { start: "node ." } }));
  writeFileSync(join(dir, "pnpm-lock.yaml"), "lockfileVersion: '9.0'\n");
  const plan = resolveRuntime(dir)!;
  expect(plan.id).toBe("node/pnpm");
  expect(plan.installCommand).toBe("pnpm install --frozen-lockfile");
  expect(plan.startCommand).toBe("pnpm run start");
});

test("a push event yields the first updated branch and rejects forged files", () => {
  const sha = "a".repeat(40);
  const zero = "0".repeat(40);
  expect(parsePush("app.42.push", `${zero} ${sha} refs/heads/main\n`)).toEqual({ repo: "app", commit: sha });
  expect(parsePush("app.42.push", `${sha} ${zero} refs/heads/old\n${zero} ${sha} refs/heads/new\n`)).toEqual({ repo: "app", commit: sha });
  expect(parsePush("app.42.push", `${zero} ${sha} refs/tags/v1\n`)).toBeUndefined();
  expect(parsePush("../x.42.push", `${zero} ${sha} refs/heads/main\n`)).toBeUndefined();
  expect(parsePush("app.42.push", `${zero} ;rm refs/heads/main\n`)).toBeUndefined();
});

test("apps: a root lockfile is one install, otherwise each manifest folder", () => {
  expect(findApps(["package.json", "pnpm-lock.yaml", "apps/web/package.json"])).toEqual(["."]);
  expect(findApps(["apps/web/package.json", "apps/web/src/a.ts", "apps/api/requirements.txt", "README.md"]))
    .toEqual(["apps/api", "apps/web"]);
  expect(findApps(["apps/web/node_modules/x/package.json", "apps/web/package.json"])).toEqual(["apps/web"]);
  expect(findApps(["a/b/c/d/package.json"])).toEqual(["."]);
  expect(findApps(["README.md"])).toEqual(["."]);
});
