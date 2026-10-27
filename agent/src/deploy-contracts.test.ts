import { expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { HOST_PATTERN, ID_PATTERN, REF_PATTERN } from "./contract";
import { envHash, lockHash } from "./deploy";
import { routesMap, widgetConf } from "./nginx";
import { wrapperScript } from "./pm2";
import { run, userEnv } from "./utils/exec";
import { resolvePathWithin } from "./utils/validation";

test("user commands never see the agent's env", async () => {
  process.env.DEVVER_SECRET = "leak";
  expect(userEnv({ NODE_ENV: "x" })).not.toHaveProperty("DEVVER_SECRET");

  // PM2 hands the shell its daemon env plus ours; only ours may survive.
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
