import { Elysia, t } from "elysia";
import { pm2Manager } from "../services/pm2-manager";
import { toApiError } from "../utils/api-error";
import type { LogsResponse } from "../types";
import { PM2_PROCESS_PATTERN } from "../utils/validation";

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
    params: t.Object({
      deploymentId: t.String({ minLength: 1, pattern: PM2_PROCESS_PATTERN }),
    }),
  },
);
