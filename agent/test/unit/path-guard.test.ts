import { describe, it, expect } from "bun:test";
import { safeJoin, assertWithin, assertSafeFilename, toSafeFilename } from "../../src/utils/path-guard";

describe("path-guard", () => {
  describe("safeJoin", () => {
    it("joins path segments", () => {
      expect(safeJoin("/base", "sub", "dir")).toBe("/base/sub/dir");
    });

    it("normalizes multiple slashes", () => {
      expect(safeJoin("/base//", "sub")).toBe("/base/sub");
    });

    it("removes trailing slash", () => {
      expect(safeJoin("/base/", "sub/")).toBe("/base/sub");
    });

    it("throws on invalid segment", () => {
      expect(() => safeJoin("/base", "sub dir")).toThrow();
      expect(() => safeJoin("/base", "sub;rm")).toThrow();
      expect(() => safeJoin("/base", "sub&&cmd")).toThrow();
    });
  });

  describe("assertSafeFilename", () => {
    it("accepts safe filenames", () => {
      expect(() => assertSafeFilename("file.txt")).not.toThrow();
      expect(() => assertSafeFilename("my-file_123.js")).not.toThrow();
      expect(() => assertSafeFilename(".env")).not.toThrow();
    });

    it("rejects path traversal", () => {
      expect(() => assertSafeFilename("..")).toThrow();
      expect(() => assertSafeFilename("../etc/passwd")).toThrow();
    });

    it("rejects null bytes", () => {
      expect(() => assertSafeFilename("file\x00.txt")).toThrow();
    });

    it("rejects special names", () => {
      expect(() => assertSafeFilename(".")).toThrow();
      expect(() => assertSafeFilename("..")).toThrow();
    });
  });

  describe("toSafeFilename", () => {
    it("converts safe names unchanged", () => {
      expect(toSafeFilename("file.txt")).toBe("file.txt");
      expect(toSafeFilename("my-file_123")).toBe("my-file_123");
    });

    it("replaces unsafe chars", () => {
      expect(toSafeFilename("file name.js")).toBe("file_name.js");
      expect(toSafeFilename("file;rm*.txt")).toBe("file_rm_.txt");
    });

    it("handles edge cases", () => {
      expect(toSafeFilename(".")).toBe("_");
      expect(toSafeFilename("..")).toBe("_");
      expect(toSafeFilename("")).toBe("_");
    });
  });

  describe("assertWithin", () => {
    it("allows paths within root", () => {
      expect(() => assertWithin("/app", "/app/subdir")).not.toThrow();
      expect(() => assertWithin("/app", "/app/deployments/abc")).not.toThrow();
    });

    it("rejects path traversal", () => {
      expect(() => assertWithin("/app", "/app/../etc")).toThrow();
      expect(() => assertWithin("/app", "/etc/passwd")).toThrow();
    });

    it("rejects paths outside root", () => {
      expect(() => assertWithin("/app", "/other")).toThrow();
    });
  });
});