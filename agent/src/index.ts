import { Elysia } from "elysia";
import { timingSafeEqual } from "crypto";
import { config } from "./config";
import { reconcile } from "./deploy";
import { AgentError, toApiError } from "./errors";
import { syncRoutes, writeWidgetConf } from "./nginx";
import { localRoutes, routes } from "./routes";

const { secret, previewDomain, projectId } = config;
if (!secret || !previewDomain || !projectId) {
  throw new Error("DEVVER_SECRET, DEVVER_PREVIEW_DOMAIN and DEVVER_PROJECT_ID are required");
}
const expected = Buffer.from(secret);
const PUBLIC_PATHS = new Set(["/health", "/__devver/context", "/hooks/push"]);

function matchesSecret(candidate: string | null): boolean {
  const received = Buffer.from(candidate ?? "");
  return expected.length === received.length && timingSafeEqual(expected, received);
}

const app = new Elysia()
  .onError(({ code, error, set }) => {
    if (code === "VALIDATION") {
      set.status = 422;
      return { code: "VALIDATION_ERROR", message: error.message };
    }
    if (code === "NOT_FOUND") {
      set.status = 404;
      return { code: "NOT_FOUND", message: "Not found." };
    }
    set.status = error instanceof AgentError ? error.status : 500;
    return toApiError(error);
  })
  .onBeforeHandle(({ request, path, set }) => {
    if (PUBLIC_PATHS.has(path) || matchesSecret(request.headers.get("x-devver-secret"))) return;
    set.status = 401;
    return { code: "UNAUTHORIZED", message: "Unauthorized." };
  })
  .use(localRoutes)
  .use(routes)
  .listen(config.port);

writeWidgetConf();
// nginx may still be starting; the file is written either way and read at its start.
await syncRoutes().catch((error) => console.error("initial nginx reload:", String(error)));
console.log(`Deploy Agent running on port ${config.port}`);
void reconcile();

export type App = typeof app;
