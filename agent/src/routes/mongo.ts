import { Elysia } from "elysia";
import { mongoInstanceService } from "../services/mongo-instance-service";
import { toApiError } from "../utils/api-error";
import type { MongoDatabaseInfo } from "../types";

export const mongoRoutes = new Elysia().get(
  "/mongo/databases",
  async ({ set }) => {
    try {
      const response: MongoDatabaseInfo[] =
        await mongoInstanceService.listDatabases();
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
);
