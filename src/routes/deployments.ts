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
  REPO_NAME_PATTERN,
} from "../utils/validation";
import { toApiError } from "../utils/api-error";

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
          build: t.String(),
          start: t.String(),
          depends: t.Optional(t.Array(t.String())),
        }),
      ),
      links: t.Optional(t.Record(t.String(), t.Record(t.String(), t.String()))),
      env: t.Optional(t.Record(t.String(), t.Record(t.String(), t.String()))),
    }),
    response: t.Union([DeploySuccessSchema, DeployErrorSchema]),
  })

  .get(
    "/deployments",
    async ({ query }) => deployService.listDeployments(query.repo),
    {
      query: t.Object({ repo: t.Optional(t.String({ minLength: 1 })) }),
      response: t.Array(DeploymentSchema),
    },
  )

  .delete(
    "/deployments/:repository/:branch",
    async ({ params, set }) => {
      try {
        await deployService.removeDeployment(params.branch, params.repository);
        return {
          success: true as const,
          branch: params.branch,
          repository: params.repository,
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
        repository: t.String({ minLength: 1, pattern: REPO_NAME_PATTERN }),
        branch: t.String({ minLength: 1, pattern: BRANCH_PATTERN }),
      }),
      response: t.Union([
        t.Object({
          success: t.Literal(true),
          branch: t.String(),
          repository: t.String(),
        }),
        ApiErrorSchema,
      ]),
    },
  );
