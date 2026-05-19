import { Elysia, t } from "elysia";
import { deployService } from "../services/deploy-service";
import { OverlayCommentPermission, type DeployBenchmark } from "../types";
import {
  BRANCH_PATTERN,
  COMMIT_PATTERN,
  PM2_PROCESS_PATTERN,
  REPO_NAME_PATTERN,
} from "../utils/validation";
import { toApiError } from "../utils/api-error";
import { pm2Manager } from "../services/pm2-manager";

const deployBodySchema = t.Object({
  repo: t.String({ minLength: 1, pattern: REPO_NAME_PATTERN }),
  branch: t.String({ minLength: 1, pattern: BRANCH_PATTERN }),
  commit: t.Optional(t.String({ pattern: COMMIT_PATTERN })),
  projectId: t.Optional(t.String({ minLength: 1 })),
  organizationId: t.Optional(t.String({ minLength: 1 })),
  overlayAccessControl: t.Object({
    commentPermission: t.Enum(OverlayCommentPermission),
  }),
  service: t.Partial(
    t.Object({
      web: t.Object({
        root: t.Optional(t.String()),
        install: t.Optional(t.String()),
        skipInstall: t.Optional(t.Boolean()),
        build: t.Optional(t.String()),
        start: t.Optional(t.String()),
      }),
      api: t.Object({
        root: t.Optional(t.String()),
        install: t.Optional(t.String()),
        skipInstall: t.Optional(t.Boolean()),
        build: t.Optional(t.String()),
        start: t.Optional(t.String()),
      }),
    }),
  ),
  env: t.Optional(t.Record(t.String(), t.String())),
});

const encoder = new TextEncoder();

function sseEvent(event: string, data: unknown): Uint8Array {
  return encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

export const deploymentRoutes = new Elysia()
  .post("/deploy", async ({ body }) => deployService.deploy(body), {
    body: deployBodySchema,
  })

  .post(
    "/deploy/stream",
    async ({ body }) => {
      let enqueue: (chunk: Uint8Array) => void;
      let close: () => void;

      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          enqueue = (chunk) => controller.enqueue(chunk);
          close = () => controller.close();
        },
      });

      const onPhaseComplete = (
        phase: keyof DeployBenchmark,
        durationMs: number,
      ) => {
        enqueue(sseEvent("phase", { phase, durationMs }));
      };

      deployService.deploy(body, onPhaseComplete).then((result) => {
        enqueue(sseEvent(result.success ? "complete" : "error", result));
        close();
      });

      return new Response(stream, {
        headers: {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          Connection: "keep-alive",
          "X-Accel-Buffering": "no",
        },
      });
    },
    { body: deployBodySchema },
  )

  .get(
    "/deployments",
    async ({ query }) => deployService.listDeployments(query),
    {
      query: t.Object({ repo: t.Optional(t.String({ minLength: 1 })) }),
    },
  )

  .delete(
    "/deployments/:deploymentId",
    async ({ params, set }) => {
      try {
        await deployService.removeDeployment(params.deploymentId);
        return {
          success: true as const,
          deploymentId: params.deploymentId,
        };
      } catch (error: any) {
        const normalized = toApiError(error, {
          code: "DEPLOYMENT_DELETE_FAILED",
          message: "Failed to delete deployment.",
        });
        set.status = normalized.status;
        return normalized.body;
      }
    },
    {
      params: t.Object({
        deploymentId: t.String({ minLength: 1 }),
      }),
    },
  )

  .post(
    "/pm2/start",
    async ({ body, set }) => {
      try {
        await pm2Manager.startExisting(body.name);
        return {
          success: true as const,
          name: body.name,
          action: "start" as const,
        };
      } catch (error: any) {
        const normalized = toApiError(error, {
          code: "PM2_START_FAILED",
          message: `Failed to start PM2 process '${body.name}'.`,
        });
        set.status = normalized.status;
        return normalized.body;
      }
    },
    {
      body: t.Object({
        name: t.String({ minLength: 1, pattern: PM2_PROCESS_PATTERN }),
      }),
    },
  )

  .post(
    "/pm2/stop",
    async ({ body, set }) => {
      try {
        await pm2Manager.stop(body.name);
        return {
          success: true as const,
          name: body.name,
          action: "stop" as const,
        };
      } catch (error: any) {
        const normalized = toApiError(error, {
          code: "PM2_STOP_FAILED",
          message: `Failed to stop PM2 process '${body.name}'.`,
        });
        set.status = normalized.status;
        return normalized.body;
      }
    },
    {
      body: t.Object({
        name: t.String({ minLength: 1, pattern: PM2_PROCESS_PATTERN }),
      }),
    },
  )

  .post(
    "/pm2/restart",
    async ({ body, set }) => {
      try {
        await pm2Manager.restart(body.name);
        return {
          success: true as const,
          name: body.name,
          action: "restart" as const,
        };
      } catch (error: any) {
        const normalized = toApiError(error, {
          code: "PM2_RESTART_FAILED",
          message: `Failed to restart PM2 process '${body.name}'.`,
        });
        set.status = normalized.status;
        return normalized.body;
      }
    },
    {
      body: t.Object({
        name: t.String({ minLength: 1, pattern: PM2_PROCESS_PATTERN }),
      }),
    },
  );
