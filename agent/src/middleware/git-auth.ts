import { Elysia } from "elysia";

export interface GitAuthorizationInput {
  authorization?: string;
  token?: string;
  originalUri?: string;
  projectId?: string;
  authUrl?: string;
  fetcher?: typeof fetch;
}

export type GitAuthorizationResult =
  | { authorized: true }
  | { authorized: false; status: number; message: string };

export async function authorizeGitRequest({
  authorization,
  token,
  originalUri,
  projectId = process.env.DEVVER_PROJECT_ID,
  authUrl = process.env.DEVVER_GIT_AUTH_URL,
  fetcher = fetch,
}: GitAuthorizationInput): Promise<GitAuthorizationResult> {
  if (!projectId || !authUrl) {
    return {
      authorized: false,
      status: 503,
      message: "Git authentication is not configured",
    };
  }

  if (!authorization && !token) {
    return { authorized: false, status: 401, message: "Git token required" };
  }

  try {
    const response = await fetcher(
      `${authUrl.replace(/\/$/, "")}/projects/${encodeURIComponent(projectId)}/git-authorize`,
      {
        method: "POST",
        headers: {
          ...(authorization ? { authorization } : {}),
          ...(token ? { "x-git-token": token } : {}),
          ...(originalUri ? { "x-original-uri": originalUri } : {}),
        },
        signal: AbortSignal.timeout(5000),
      },
    );

    if (response.ok) return { authorized: true };
    if (response.status >= 500) {
      return {
        authorized: false,
        status: 503,
        message: "Git authorization service unavailable",
      };
    }
    return {
      authorized: false,
      status: response.status === 401 ? 401 : 403,
      message:
        response.status === 403
          ? "Git token scope does not match this repository"
          : response.status === 401
            ? "Invalid or expired Git token"
            : "Git authorization rejected the request",
    };
  } catch {
    return {
      authorized: false,
      status: 503,
      message: "Git authorization service unavailable",
    };
  }
}

export const gitAuthRoutes = new Elysia().all(
  "/internal/git-auth",
  async ({ request, set }) => {
    const result = await authorizeGitRequest({
      authorization: request.headers.get("authorization") ?? undefined,
      token: request.headers.get("x-git-token") ?? undefined,
      originalUri: request.headers.get("x-original-uri") ?? undefined,
    });

    if (!result.authorized) {
      set.status = result.status;
      set.headers["www-authenticate"] = 'Basic realm="Devver Git"';
      return { success: false as const, error: result.message };
    }

    set.status = 204;
    return;
  },
);
