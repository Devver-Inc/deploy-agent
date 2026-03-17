import { Elysia, t } from "elysia";
import { repoRoutes } from "./routes/repos";
import { deploymentRoutes } from "./routes/deployments";
import { logRoutes } from "./routes/logs";

const DEVVER_SECRET = process.env.DEVVER_SECRET;
if (!DEVVER_SECRET) {
  throw new Error("DEVVER_SECRET environment variable is required");
}
const PORT = process.env.PORT ?? 8080;

const app = new Elysia()
  .onError(({ code, error, set }) => {
    if (code === "VALIDATION") {
      set.status = 422;
      return {
        success: false as const,
        error: {
          code: "VALIDATION_ERROR",
          message: error.message,
        },
      };
    }
  })

  .onBeforeHandle(({ request, set, path }) => {
    if (path === "/health") return;
    const secret = request.headers.get("x-devver-secret");
    if (secret !== DEVVER_SECRET) {
      set.status = 401;
      return {
        success: false as const,
        error: {
          code: "UNAUTHORIZED",
          message: "Unauthorized",
        },
      };
    }
  })

  .get(
    "/health",
    () => ({
      status: "ok",
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
    }),
    {
      response: t.Object({
        status: t.String(),
        timestamp: t.String(),
        uptime: t.Number(),
      }),
    },
  )

  .use(repoRoutes)
  .use(deploymentRoutes)
  .use(logRoutes)

  .listen(PORT);

console.log(`Deploy Agent running on port ${PORT}`);

export type App = typeof app;
