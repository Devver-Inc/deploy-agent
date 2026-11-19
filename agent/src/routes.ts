import { Elysia, t } from "elysia";
import { Deployment, HOST_PATTERN, ID_PATTERN, REPO_PATTERN } from "./contract";
import { setAliases } from "./nginx";
import { config } from "./config";
import * as deployments from "./deploy";
import { toApiError } from "./errors";
import { createRepo, firstParentHistory, mergeCommits, nearestDeployed, resolveCommit } from "./git";
import { listMongoDatabases } from "./mongo";
import * as pm2 from "./pm2";
import { repoState } from "./repo-state";
import { store } from "./store";

const idParams = t.Object({ id: t.String({ pattern: ID_PATTERN }) });
const repoParams = t.Object({ name: t.String({ pattern: REPO_PATTERN }) });
const COMMIT_PATTERN = "^([0-9a-f]{40}|[0-9a-f]{64})$";
const encoder = new TextEncoder();
const sse = (event: string, data: unknown) =>
  encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);

function phaseStream(label: string, work: (emit: deployments.Emit) => Promise<unknown>): Response {
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const emit: deployments.Emit = (phase, durationMs) => controller.enqueue(sse("phase", { phase, durationMs }));
      // Installs and health checks can stay silent for a minute; idle connections get cut.
      const heartbeat = setInterval(() => controller.enqueue(encoder.encode(": ping\n\n")), 10_000);
      try {
        controller.enqueue(sse("done", await work(emit)));
      } catch (error) {
        console.error(`${label} failed: ${toApiError(error).message}`);
        controller.enqueue(sse("failed", toApiError(error)));
      } finally {
        clearInterval(heartbeat);
      }
      controller.close();
    },
  });
  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream",
      "cache-control": "no-cache",
      "x-accel-buffering": "no",
    },
  });
}

export const routes = new Elysia()
  .put(
    "/deployments/:id",
    async ({ params, body }) => {
      await resolveCommit(body.repo, body.ref);
      return phaseStream(`deploy ${params.id}`, (emit) => deployments.deploy(params.id, body, emit));
    },
    { params: idParams, body: Deployment },
  )
  .get("/deployments", () => deployments.list())
  .delete(
    "/deployments/:id",
    async ({ params, set }) => {
      await deployments.remove(params.id);
      set.status = 204;
    },
    { params: idParams },
  )
  .post(
    "/deployments/:id/:action",
    async ({ params, set }) => {
      await pm2.control(deployments.find(params.id).release, params.action);
      set.status = 204;
    },
    {
      params: t.Object({
        id: t.String({ pattern: ID_PATTERN }),
        action: t.Union([t.Literal("stop"), t.Literal("start"), t.Literal("restart")]),
      }),
    },
  )
  .get(
    "/deployments/:id/logs",
    async ({ params, query }) =>
      new Response(await pm2.logs(deployments.find(params.id).release, query.tail ?? 200), {
        headers: { "content-type": "text/plain; charset=utf-8" },
      }),
    { params: idParams, query: t.Object({ tail: t.Optional(t.Numeric({ minimum: 1, maximum: 5000 })) }) },
  )
  .post(
    "/repos/:name",
    async ({ params, body, set }) => {
      await createRepo(params.name);
      if (body) repoState.setInstall(params.name, body.install);
      set.status = 204;
    },
    {
      params: t.Object({ name: t.String({ pattern: REPO_PATTERN }) }),
      body: t.Optional(t.Object({ install: t.Optional(t.String({ minLength: 1, maxLength: 1000 })) })),
    },
  )
  .post(
    "/repos/:name/parent",
    async ({ params, body }) => {
      const history = await firstParentHistory(params.name, body.commit);
      const deployed = new Map(body.candidates.map((c) => [c.commit, c.deploymentId]));
      return { parentDeploymentId: nearestDeployed(history, deployed) };
    },
    {
      params: repoParams,
      body: t.Object({
        commit: t.String({ pattern: COMMIT_PATTERN }),
        candidates: t.Array(
          t.Object({ deploymentId: t.String({ pattern: ID_PATTERN }), commit: t.String({ pattern: COMMIT_PATTERN }) }),
          { maxItems: 10_000 },
        ),
      }),
    },
  )
  .post(
    "/repos/:name/merge",
    async ({ params, body }) => ({ commit: await mergeCommits(params.name, body.first, body.second) }),
    {
      params: repoParams,
      body: t.Object({ first: t.String({ pattern: COMMIT_PATTERN }), second: t.String({ pattern: COMMIT_PATTERN }) }),
    },
  )
  .put(
    "/aliases",
    async ({ body, set }) => {
      await setAliases(body);
      set.status = 204;
    },
    {
      body: t.Array(
        t.Object({ host: t.String({ pattern: HOST_PATTERN }), deploymentId: t.String({ pattern: ID_PATTERN }) }),
        { maxItems: 1000 },
      ),
    },
  )
  .get("/databases/mongo", () => listMongoDatabases());

export const localRoutes = new Elysia()
  .get("/health", () => ({ status: "ok" }))
  .get("/__devver/context", ({ request, set }) => {
    const host = (request.headers.get("host") ?? "").split(":")[0]!.toLowerCase();
    const release = store.byHost(host);
    if (!release) {
      set.status = 404;
      return { code: "DEPLOYMENT_NOT_FOUND", message: `No deployment serves ${host}.` };
    }
    return {
      deploymentId: release.id,
      repo: release.repo,
      ref: release.ref,
      projectId: config.projectId,
      organizationId: config.organizationId,
    };
  });
