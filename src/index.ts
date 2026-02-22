import { Elysia, t } from "elysia";
import { deployService } from "./services/deploy-service";
import { pm2Manager } from "./services/pm2-manager";
import { repoManager } from "./services/repo-manager";

const DEVVER_SECRET = process.env.DEVVER_SECRET;
const PORT = process.env.PORT ?? 8080;

const RepoSchema = t.Object({
  name: t.String(),
  createdAt: t.String(),
  pushUrl: t.String(),
});

const PM2ProcessSchema = t.Object({
  name: t.String(),
  pm_id: t.Number(),
  status: t.Union([
    t.Literal("online"),
    t.Literal("stopped"),
    t.Literal("errored"),
  ]),
  cpu: t.Number(),
  memory: t.Number(),
});

const DeploymentSchema = t.Object({
  repo: t.String(),
  branch: t.String(),
  deploymentId: t.String(),
  services: t.Record(t.String(), t.Number()),
  processes: t.Array(PM2ProcessSchema),
});

const DeploySuccessSchema = t.Object({
  success: t.Literal(true),
  branch: t.String(),
  commit: t.String(),
  services: t.Record(
    t.String(),
    t.Object({ port: t.Number(), url: t.String() }),
  ),
  duration: t.Number(),
});

const DeployErrorSchema = t.Object({
  success: t.Literal(false),
  error: t.Object({
    code: t.String(),
    message: t.String(),
    logs: t.Optional(t.String()),
    step: t.Optional(t.Number()),
    service: t.Optional(t.String()),
  }),
  duration: t.Number(),
});

const LogEntrySchema = t.Object({
  service: t.String(),
  level: t.Union([t.Literal("info"), t.Literal("error")]),
  message: t.String(),
  timestamp: t.String(),
});

const app = new Elysia()
  .onBeforeHandle(({ request, set, path }) => {
    if (path === "/health") return;
    const secret = request.headers.get("x-devver-secret");
    if (secret !== DEVVER_SECRET) {
      set.status = 401;
      return { error: "Unauthorized" };
    }
  })

  .get(
    "/health",
    () => ({
      status: "ok",
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
    }),
    {
      response: t.Object({
        status: t.String(),
        timestamp: t.String(),
        uptime: t.Number(),
      }),
    },
  )

  .get(
    "/repos",
    () => {
      return repoManager.list().map((r) => ({
        ...r,
        pushUrl: repoManager.getPushUrl(r.name),
      }));
    },
    {
      response: t.Array(RepoSchema),
    },
  )

  .post(
    "/repos",
    async ({ body }) => {
      try {
        await repoManager.create(body.name, body.baseUrl);
        return {
          success: true as const,
          name: body.name,
          pushUrl: repoManager.getPushUrl(body.name),
        };
      } catch (error: any) {
        return { success: false as const, error: error.message as string };
      }
    },
    {
      body: t.Object({
        name: t.String({ minLength: 1, pattern: "^[a-z0-9-]+$" }),
        baseUrl: t.String(),
      }),
      response: t.Union([
        t.Object({
          success: t.Literal(true),
          name: t.String(),
          pushUrl: t.String(),
        }),
        t.Object({ success: t.Literal(false), error: t.String() }),
      ]),
    },
  )

  .delete(
    "/repos/:name",
    async ({ params }) => {
      try {
        const deployments = await deployService.listDeployments(params.name);
        for (const dep of deployments) {
          await deployService.removeDeployment(dep.branch, params.name);
        }
        await repoManager.delete(params.name);
        return { success: true as const, name: params.name };
      } catch (error: any) {
        return { success: false as const, error: error.message as string };
      }
    },
    {
      response: t.Union([
        t.Object({ success: t.Literal(true), name: t.String() }),
        t.Object({ success: t.Literal(false), error: t.String() }),
      ]),
    },
  )

  .post(
    "/deploy",
    async ({ body }) => {
      const result = await deployService.deploy(body);
      return result;
    },
    {
      body: t.Object({
        repo: t.String({ minLength: 1 }),
        branch: t.String(),
        commit: t.Optional(t.String()),
        services: t.Record(
          t.String(),
          t.Object({
            root: t.Optional(t.String()),
            install: t.Optional(t.String()),
            build: t.String(),
            start: t.String(),
            depends: t.Optional(t.Array(t.String())),
          }),
        ),
        links: t.Optional(
          t.Record(t.String(), t.Record(t.String(), t.String())),
        ),
        env: t.Optional(t.Record(t.String(), t.Record(t.String(), t.String()))),
      }),
      response: t.Union([DeploySuccessSchema, DeployErrorSchema]),
    },
  )

  .get(
    "/deployments",
    async ({ query }) => {
      return await deployService.listDeployments(query.repo);
    },
    {
      query: t.Object({ repo: t.Optional(t.String({ minLength: 1 })) }),
      response: t.Array(DeploymentSchema),
    },
  )

  .delete(
    "/deployments/:repository/:branch",
    async ({ params }) => {
      try {
        await deployService.removeDeployment(params.branch, params.repository);
        return {
          success: true as const,
          branch: params.branch,
          repository: params.repository,
        };
      } catch (error: any) {
        return { success: false as const, error: error.message as string };
      }
    },
    {
      response: t.Union([
        t.Object({
          success: t.Literal(true),
          branch: t.String(),
          repository: t.String(),
        }),
        t.Object({ success: t.Literal(false), error: t.String() }),
      ]),
    },
  )

  .get(
    "/logs/:deploymentId",
    async ({ params }) => {
      const processes = await pm2Manager.list();
      const branchProcesses = processes.filter((p) =>
        p.name.includes(`-${params.deploymentId}-`),
      );

      if (branchProcesses.length === 0) {
        return { logs: [] as typeof logs };
      }

      const logs: {
        service: string;
        level: "info" | "error";
        message: string;
        timestamp: string;
      }[] = [];
      for (const proc of branchProcesses) {
        const raw = await pm2Manager.getLogs(proc.name, 50);
        const service = proc.name.split("-")[0];
        for (const line of raw.split("\n").filter(Boolean)) {
          logs.push({
            service,
            level: line.includes("error") ? "error" : "info",
            message: line,
            timestamp: new Date().toISOString(),
          });
        }
      }
      return { logs };
    },
    {
      response: t.Object({ logs: t.Array(LogEntrySchema) }),
    },
  )

  .listen(PORT);

console.log(`Deploy Agent running on port ${PORT}`);

export type App = typeof app;
