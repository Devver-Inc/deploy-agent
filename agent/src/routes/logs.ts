import { Elysia, t } from "elysia";
import { pm2Manager } from "../services/pm2-manager";
import { ApiErrorSchema, LogEntrySchema } from "../schemas";
import { toApiError } from "../utils/api-error";
import type { LogsResponse } from "../types";

export const logRoutes = new Elysia().get(
  "/logs/:deploymentId",
  async ({ params, set }) => {
    try {
      const response: LogsResponse = {
        logs: await pm2Manager.getLogsByDeployment(params.deploymentId),
      };
      return response;
    } catch (error: any) {
      const normalized = toApiError(error, {
        code: "LOGS_FETCH_FAILED",
        message: "Failed to fetch logs.",
      });
      set.status = normalized.status;
      return normalized.body;
    }
  },
  {
    response: t.Union([
      t.Object({ logs: t.Array(LogEntrySchema) }),
      ApiErrorSchema,
    ]),
  },
);
