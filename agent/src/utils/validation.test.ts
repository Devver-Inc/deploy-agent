import { describe, expect, it } from "bun:test";
import { DeployValidator } from "../services/deploy/deploy-validator";
import { OverlayCommentPermission, type DeployRequest } from "../types";
import { resolvePathWithin } from "./validation";

const validator = new DeployValidator();
const baseRequest: DeployRequest = {
  repo: "example",
  branch: "main",
  overlayAccessControl: {
    commentPermission: OverlayCommentPermission.TEAM_ONLY,
  },
  service: {
    web: {
      root: "apps/web",
      start: "bun run start",
    },
  },
};

describe("deployment validation", () => {
  it("accepts a service root inside the worktree", () => {
    expect(resolvePathWithin("/tmp/worktree", "apps/web")).toBe(
      "/tmp/worktree/apps/web",
    );
    expect(resolvePathWithin("/tmp/worktree", "..cache")).toBe(
      "/tmp/worktree/..cache",
    );
    expect(() => validator.validateRequest(baseRequest)).not.toThrow();
  });

  it("rejects a service root outside the worktree", () => {
    expect(() => resolvePathWithin("/tmp/worktree", "../../etc")).toThrow(
      "Path must stay inside the deployment worktree.",
    );
    expect(() =>
      validator.validateRequest({
        ...baseRequest,
        service: { web: { root: "../../etc" } },
      }),
    ).toThrow();
  });

  it("requires exactly one service", () => {
    expect(() =>
      validator.validateRequest({
        ...baseRequest,
        service: {},
      }),
    ).toThrow();

    expect(() =>
      validator.validateRequest({
        ...baseRequest,
        service: {
          web: { start: "bun run start" },
          api: { start: "bun run start" },
        },
      }),
    ).toThrow();
  });
});
