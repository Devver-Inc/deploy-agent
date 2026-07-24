import { describe, expect, it, mock } from "bun:test";
import { OverlayCommentPermission } from "../../types";
import type { DeployContext } from "./internal-types";

const calls: string[] = [];

mock.module("../git-manager", () => ({
  gitManager: {
    removeWorktree: async () => {
      calls.push("git:remove-worktree");
    },
    updateWorktree: async () => {
      calls.push("git:update-worktree");
    },
    worktreeExists: () => false,
    getCurrentCommit: async () => "",
  },
}));

mock.module("../nginx-manager", () => ({
  nginxManager: {
    getConfigSnapshot: () => ({ exists: false }),
    restoreConfig: () => {
      calls.push("nginx:restore");
    },
    removeConfig: async () => {
      calls.push("nginx:remove");
    },
    reload: async () => {
      calls.push("nginx:reload");
    },
  },
}));

mock.module("../pm2-manager", () => ({
  pm2Manager: {
    delete: async () => {
      calls.push("pm2:delete");
    },
  },
}));

mock.module("../port-manager", () => ({
  portManager: {
    get: () => undefined,
    update: () => {
      calls.push("port:update");
    },
    release: () => {
      calls.push("port:release");
    },
  },
}));

const { DeployRollbackService } = await import("./deploy-rollback-service");

describe("DeployRollbackService", () => {
  it("cleans up every completed stage for a new deployment", async () => {
    calls.length = 0;
    const logEvents: string[] = [];
    const service = new DeployRollbackService({
      log: (_level, event) => {
        logEvents.push(event);
      },
    });
    const ctx: DeployContext = {
      repo: "example",
      branch: "main",
      deploymentId: "example-main",
      requestId: "request-1",
      commit: "abcdef0",
      overlayAccessControl: {
        commentPermission: OverlayCommentPermission.TEAM_ONLY,
      },
      isNewWorktree: true,
      startedProcess: "example-main-web",
      portAllocated: true,
      benchmark: {},
    };

    const result = await service.rollback(ctx);

    expect(result).toEqual({
      attempted: true,
      success: true,
      message: undefined,
    });
    expect(calls).toEqual([
      "pm2:delete",
      "port:release",
      "git:remove-worktree",
      "nginx:remove",
      "nginx:reload",
    ]);
    expect(logEvents).toEqual(["deploy.rollback"]);
  });
});
