import { Elysia, t } from "elysia";
import { deployService } from "../services/deploy-service";
import {
  ApiErrorSchema,
  DeploymentSchema,
  DeploySuccessSchema,
  DeployErrorSchema,
} from "../schemas";
import {
  BRANCH_PATTERN,
  COMMIT_PATTERN,
  PM2_PROCESS_PATTERN,
  REPO_NAME_PATTERN,
} from "../utils/validation";
import { toApiError } from "../utils/api-error";
import { pm2Manager } from "../services/pm2-manager";

export const deploymentRoutes = new Elysia()
  .post("/deploy", async ({ body }) => deployService.deploy(body), {
    body: t.Object({
      repo: t.String({ minLength: 1, pattern: REPO_NAME_PATTERN }),
      branch: t.String({ minLength: 1, pattern: BRANCH_PATTERN }),
      commit: t.Optional(t.String({ pattern: COMMIT_PATTERN })),
      services: t.Record(
        t.String(),
        t.Object({
          root: t.Optional(t.String()),
          install: t.Optional(t.String()),
          skipInstall: t.Optional(t.Boolean()),
          build: t.String(),
          start: t.String(),
          depends: t.Optional(t.Array(t.String())),
        }),
      ),
      env: t.Optional(t.Record(t.String(), t.Record(t.String(), t.String()))),
    }),
    response: t.Union([DeploySuccessSchema, DeployErrorSchema]),
  })

  .get(
    "/deployments",
    async ({ query }) => deployService.listDeployments(query),
    {
      query: t.Object({ repo: t.Optional(t.String({ minLength: 1 })) }),
      response: t.Array(DeploymentSchema),
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
      response: t.Union([
        t.Object({
          success: t.Literal(true),
          deploymentId: t.String(),
        }),
        ApiErrorSchema,
      ]),
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
      response: t.Union([
        t.Object({
          success: t.Literal(true),
          name: t.String(),
          action: t.Literal("start"),
        }),
        ApiErrorSchema,
      ]),
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
      response: t.Union([
        t.Object({
          success: t.Literal(true),
          name: t.String(),
          action: t.Literal("stop"),
        }),
        ApiErrorSchema,
      ]),
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
      response: t.Union([
        t.Object({
          success: t.Literal(true),
          name: t.String(),
          action: t.Literal("restart"),
        }),
        ApiErrorSchema,
      ]),
    },
  );
