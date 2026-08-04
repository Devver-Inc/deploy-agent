import { Elysia, t } from "elysia";
import { repoRoutes } from "./routes/repos";
import { deploymentRoutes } from "./routes/deployments";
import { logRoutes } from "./routes/logs";
import { mongoRoutes } from "./routes/mongo";
import { gitAuthRoutes } from "./middleware/git-auth";
import { timingSafeEqual } from "crypto";
import { ApplicationError } from "./errors/application-error";
import { toApiError } from "./utils/api-error";

const DEVVER_SECRET = process.env.DEVVER_SECRET;
if (!DEVVER_SECRET) {
  throw new Error("DEVVER_SECRET environment variable is required");
}
const EXPECTED_DEVVER_SECRET = DEVVER_SECRET;
const PORT = process.env.PORT ?? 8080;

function matchesSecret(candidate: string | null): boolean {
  if (!candidate) return false;
  const expected = Buffer.from(EXPECTED_DEVVER_SECRET);
  const received = Buffer.from(candidate);
  return (
    expected.length === received.length && timingSafeEqual(expected, received)
  );
}

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

    if (error instanceof ApplicationError) {
      const normalized = toApiError(error, {
        code: "REQUEST_FAILED",
        message: "Request failed.",
      });
      set.status = normalized.status;
      return normalized.body;
    }
  })

  .onBeforeHandle(({ request, set, path }) => {
    if (path === "/health" || path === "/internal/git-auth") return;

    // Non-git paths: validate shared secret
    const secret = request.headers.get("x-devver-secret");
    if (!matchesSecret(secret)) {
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

  .use(gitAuthRoutes)

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
  .use(mongoRoutes)

  .listen(PORT);

console.log(`Deploy Agent running on port ${PORT}`);

export type App = typeof app;
