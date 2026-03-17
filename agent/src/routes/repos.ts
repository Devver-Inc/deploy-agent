import { Elysia, t } from "elysia";
import { repoManager } from "../services/repo-manager";
import { REPO_NAME_PATTERN } from "../utils/validation";
import { deployService } from "../services/deploy-service";
import { toApiError } from "../utils/api-error";
import type { RepoResponse } from "../types";

export const repoRoutes = new Elysia()
  .get(
    "/repos",
    (): RepoResponse[] =>
      repoManager.list().map((r) => ({
        name: r.name,
        createdAt: r.createdAt,
        pushUrl: repoManager.getPushUrl(r.name),
      })),
  )

  .post(
    "/repos",
    async ({ body, set }) => {
      try {
        await repoManager.create(body);
        return {
          success: true as const,
          name: body.name,
          pushUrl: repoManager.getPushUrl(body.name),
        };
      } catch (error: any) {
        const normalized = toApiError(error, {
          code: "REPO_CREATE_FAILED",
          message: "Failed to create repository.",
        });
        set.status = normalized.status;
        return normalized.body;
      }
    },
    {
      body: t.Object({
        name: t.String({ minLength: 1, pattern: REPO_NAME_PATTERN }),
        baseUrl: t.String(),
      }),
    },
  )

  .delete(
    "/repos/:name",
    async ({ params, set }) => {
      try {
        await deployService.deleteRepo(params.name);
        return { success: true as const, name: params.name };
      } catch (error: any) {
        const normalized = toApiError(error, {
          code: "REPO_DELETE_FAILED",
          message: "Failed to delete repository.",
        });
        set.status = normalized.status;
        return normalized.body;
      }
    },
    {
      params: t.Object({
        name: t.String({ minLength: 1, pattern: REPO_NAME_PATTERN }),
      }),
    },
  );
