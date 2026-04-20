import { describe, it, expect } from "bun:test";
import { DeployError } from "../../src/utils/errors";

describe("DeployError", () => {
  it("creates error with code and message", () => {
    const error = new DeployError("VALIDATION_ERROR", "test message");

    expect(error.code).toBe("VALIDATION_ERROR");
    expect(error.message).toBe("test message");
    expect(error instanceof Error).toBe(true);
  });

  it("includes optional properties", () => {
    const error = new DeployError("INSTALL_ERROR", "failed", {
      logs: "install logs",
      step: 3,
      stage: "INSTALL",
      service: "web",
      context: { key: "value" },
    });

    expect(error.logs).toBe("install logs");
    expect(error.step).toBe(3);
    expect(error.stage).toBe("INSTALL");
    expect(error.service).toBe("web");
    expect(error.context).toEqual({ key: "value" });
  });

  it("wraps existing DeployError", () => {
    const original = new DeployError("GIT_ERROR", "original");
    const wrapped = DeployError.wrap(original);

    expect(wrapped).toBe(original);
  });

  it("wraps plain Error with cause", () => {
    const original = new Error("original error");
    const wrapped = DeployError.wrap(original);

    expect(wrapped.code).toBe("DEPLOY_ERROR");
    expect(wrapped.message).toBe("original error");
    expect(wrapped.cause).toBe(original);
  });

  it("wraps unknown value", () => {
    const wrapped = DeployError.wrap("string error");

    expect(wrapped.code).toBe("DEPLOY_ERROR");
    expect(wrapped.message).toBe("string error");
  });

  it("preserves stack via cause", () => {
    const original = new Error("original");
    const wrapped = DeployError.wrap(original);

    expect(wrapped.cause).toBe(original);
  });

  describe("static factories", () => {
    it("validation factory", () => {
      const error = DeployError.validation("invalid input", { field: "name" });

      expect(error.code).toBe("VALIDATION_ERROR");
      expect(error.message).toBe("invalid input");
      expect(error.context).toEqual({ field: "name" });
    });

    it("gitFailure factory", () => {
      const error = DeployError.gitFailure("git failed", { stage: "WORKTREE" });

      expect(error.code).toBe("GIT_ERROR");
      expect(error.stage).toBe("WORKTREE");
    });

    it("portExhausted factory", () => {
      const error = DeployError.portExhausted("no ports");

      expect(error.code).toBe("PORT_CONFLICT");
    });

    it("pm2StartFailed factory", () => {
      const error = DeployError.pm2StartFailed("process crashed");

      expect(error.code).toBe("PROCESS_ERROR");
    });

    it("nginxFailed factory", () => {
      const error = DeployError.nginxFailed("nginx error");

      expect(error.code).toBe("NGINX_ERROR");
    });

    it("rollback factory", () => {
      const error = DeployError.rollback("rollback failed");

      expect(error.code).toBe("ROLLBACK_ERROR");
    });

    it("commandFailed factory", () => {
      const error = DeployError.commandFailed("command error");

      expect(error.code).toBe("DEPLOY_ERROR");
    });

    it("installError factory", () => {
      const error = DeployError.installError("install failed");

      expect(error.code).toBe("INSTALL_ERROR");
    });

    it("buildError factory", () => {
      const error = DeployError.buildError("build failed");

      expect(error.code).toBe("BUILD_ERROR");
    });

    it("notFound factory", () => {
      const error = DeployError.notFound("not found");

      expect(error.code).toBe("REPO_NOT_FOUND");
    });

    it("conflict factory", () => {
      const error = DeployError.conflict("already exists");

      expect(error.code).toBe("DEPLOY_ERROR");
      expect(error.context?.conflict).toBe(true);
    });

    it("upstream factory", () => {
      const error = DeployError.upstream("external service down");

      expect(error.context?.upstream).toBe(true);
    });
  });
});