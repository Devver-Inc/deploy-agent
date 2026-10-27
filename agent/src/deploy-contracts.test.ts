import { expect, test } from "bun:test";
import { GitPaths } from "./services/git/git-paths";
import { matchesDeployment } from "./services/pm2/pm2-process-name";
import { NginxConfigBuilder } from "./services/nginx/nginx-config-builder";
import { publicHost } from "./services/nginx/public-address";
import { exec } from "./utils/exec";
import { buildWrapperScript } from "./services/pm2-manager";

test("user commands never see the agent's env", async () => {
  process.env.DEVVER_SECRET = "leak";
  const install = await exec("env", undefined, { env: { NODE_ENV: "x" } });
  expect(install.stdout).toContain("NODE_ENV=x");
  expect(install.stdout).not.toContain("DEVVER_SECRET");

  // PM2 hands the wrapper its daemon env plus ours; only ours may survive.
  const script = buildWrapperScript(`echo "it's $PORT"; env`, { PORT: "3000" });
  const start = await exec(script.split("\n")[1]!, undefined, {
    unsafe: true,
    env: { PORT: "3000", DEVVER_SECRET: "leak" },
  });
  expect(start.stdout).toContain("it's 3000");
  expect(start.stdout).not.toContain("DEVVER_SECRET");
});

test("web keeps its historical id; api gets its own, collision-free id", () => {
  const paths = new GitPaths();
  expect(paths.getDeploymentId("feat/x", "app", "web")).toBe("app-feat-x");
  expect(paths.getDeploymentId("feat/x", "app", "api")).toBe("app.api-feat-x");
  // No branch can produce the api id as a web id: repo names have no dots.
  expect(paths.getWorktreePath("main", "app", "api")).toBe("/app/deployments/app.api/main");
});

test("request values cannot break out of the generated nginx config", () => {
  const conf = new NginxConfigBuilder().buildSite(
    "app-main.p.dev",
    "app",
    "main",
    { port: 3000 },
    undefined,
    `x'; } location / { alias /app/data; } #`,
    "$host\\",
  );
  const widgetLine = conf.split("\n").find((l) => l.includes("'</body>'"))!;
  // Exactly the 4 delimiting quotes of `sub_filter '</body>' '...'` remain unescaped.
  expect(widgetLine.match(/(?<!\\)'/g)).toHaveLength(4);
  expect(widgetLine).not.toContain("$host");
});

test("preview hosts are DNS-safe and unique per service", () => {
  const id = "65f0c0ffee00000000000abc";
  expect(publicHost("app-feat-x", "p.dev", id)).toBe(`app-feat-x--${id}.p.dev`);
  expect(publicHost("app.api-feat-x", "p.dev", id)).toBe(`app--api-feat-x--${id}.p.dev`);
  // Truncation must keep the project suffix: Traefik routes on it.
  const long = publicHost(`app-${"b".repeat(80)}`, "p.dev", id).split(".")[0]!;
  expect(long.length).toBeLessThanOrEqual(63);
  expect(long.endsWith(`--${id}`)).toBe(true);
  expect(() => publicHost("app-main", undefined, id)).toThrow();
});

test("deployment match is anchored on the whole process name", () => {
  expect(matchesDeployment("web-app-main-3000", "app-main")).toBe(true);
  expect(matchesDeployment("web-my-app-main-3000", "app-main")).toBe(false);
  expect(matchesDeployment("api-app.api-main-3001", "app-main")).toBe(false);
  expect(matchesDeployment("api-app.api-main-3001", "app.api-main")).toBe(true);
});
