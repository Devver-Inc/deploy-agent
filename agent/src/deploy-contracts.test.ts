import { expect, test } from "bun:test";
import { GitPaths } from "./services/git/git-paths";
import { matchesDeployment } from "./services/pm2/pm2-process-name";
import { NginxConfigBuilder } from "./services/nginx/nginx-config-builder";
import { publicAddress } from "./services/nginx/public-address";
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
  const conf = new NginxConfigBuilder().build(
    "app",
    "main",
    { service: "web", port: 3000 },
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
  const web = publicAddress("app-feat-x", "app", "feat/x", "web", "p.dev");
  const api = publicAddress("app.api-feat-x", "app", "feat/x", "api", "p.dev");
  expect(web).toEqual({ host: "app-feat-x.p.dev", path: "" });
  expect(api.host).toBe("app--api-feat-x.p.dev");
  const long = publicAddress(`app-${"b".repeat(80)}`, "app", "b", "web", "p.dev");
  expect(long.host!.split(".")[0]!.length).toBeLessThanOrEqual(63);
  expect(publicAddress("app-main", "app", "main", "web", undefined)).toEqual({
    path: "/app/main",
  });
});

test("deployment match is anchored on the whole process name", () => {
  expect(matchesDeployment("web-app-main-3000", "app-main")).toBe(true);
  expect(matchesDeployment("web-my-app-main-3000", "app-main")).toBe(false);
  expect(matchesDeployment("api-app.api-main-3001", "app-main")).toBe(false);
  expect(matchesDeployment("api-app.api-main-3001", "app.api-main")).toBe(true);
});
