import { Elysia, t } from "elysia";
import { mongoInstanceService } from "../services/mongo-instance-service";
import { toApiError } from "../utils/api-error";
import { REPO_NAME_PATTERN } from "../utils/validation";
import type { MongoDatabaseInfo } from "../types";

export const mongoRoutes = new Elysia().get(
  "/mongo/databases",
  async ({ query, set }) => {
    try {
      const response: MongoDatabaseInfo[] =
        await mongoInstanceService.listDatabases(query);
      return response;
    } catch (error: any) {
      const normalized = toApiError(error, {
        code: "MONGO_DATABASES_FETCH_FAILED",
        message: "Failed to fetch Mongo databases.",
      });
      set.status = normalized.status;
      return normalized.body;
    }
  },
  {
    query: t.Object({
      orgSlug: t.String({ minLength: 1, pattern: REPO_NAME_PATTERN }),
      projectSlug: t.String({ minLength: 1, pattern: REPO_NAME_PATTERN }),
    }),
  },
);
