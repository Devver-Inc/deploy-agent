import { Elysia, t } from "elysia";
import { Deployment, ID_PATTERN, REF_PATTERN, REPO_PATTERN, type Phase } from "./contract";
import { config } from "./config";
import * as deployments from "./deploy";
import { toApiError } from "./errors";
import { createRepo, resolveCommit } from "./git";
import { listMongoDatabases } from "./mongo";
import * as pm2 from "./pm2";
import { store } from "./store";

const idParams = t.Object({ id: t.String({ pattern: ID_PATTERN }) });
const encoder = new TextEncoder();
const sse = (event: string, data: unknown) =>
  encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);

export const routes = new Elysia()
  .put(
    "/deployments/:id",
    async ({ params, body }) => {
      // Fails as plain 4xx JSON (missing ref) before the 200 stream opens.
      await createRepo(body.repo);
      await resolveCommit(body.repo, body.ref);
      const stream = new ReadableStream<Uint8Array>({
        async start(controller) {
          const emit = (phase: Phase, durationMs: number) =>
            controller.enqueue(sse("phase", { phase, durationMs }));
          // Installs and health checks can stay silent for a minute; idle connections get cut.
          const heartbeat = setInterval(() => controller.enqueue(encoder.encode(": ping\n\n")), 10_000);
          try {
            controller.enqueue(sse("done", await deployments.deploy(params.id, body, emit)));
          } catch (error) {
            console.error(`deploy ${params.id} failed: ${toApiError(error).message}`);
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
    async ({ params, set }) => {
      await createRepo(params.name);
      set.status = 204;
    },
    { params: t.Object({ name: t.String({ pattern: REPO_PATTERN }) }) },
  )
  .delete(
    "/repos/:name",
    async ({ params, set }) => {
      await deployments.removeRepo(params.name);
      set.status = 204;
    },
    { params: t.Object({ name: t.String({ pattern: REPO_PATTERN }) }) },
  )
  .get("/databases/mongo", () => listMongoDatabases());

/** No secret: reached only from inside the pod (nginx and the git hook). */
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
  })
  .post(
    "/hooks/push",
    ({ body, set }) => {
      void deployments.onPush(body.repo, body.ref);
      set.status = 202;
    },
    { body: t.Object({ repo: t.String({ pattern: REPO_PATTERN }), ref: t.String({ pattern: REF_PATTERN }) }) },
  );
