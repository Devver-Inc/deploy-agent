import { describe, it, expect } from "bun:test";
import { parseCommand, ALLOWED_BINARIES, isAllowedBinary } from "../../src/utils/command-parser";

describe("command-parser", () => {
  describe("parseCommand", () => {
    it("parses simple command", () => {
      const result = parseCommand("bun install");

      expect(result.bin).toBe("bun");
      expect(result.argv).toEqual(["install"]);
      expect(result.raw).toBe("bun install");
    });

    it("parses command with args", () => {
      const result = parseCommand("npm run build --prefix=myapp");

      expect(result.bin).toBe("npm");
      expect(result.argv).toEqual(["run", "build", "--prefix=myapp"]);
    });

    it("normalizes nodejs to node", () => {
      const result = parseCommand("nodejs script.js");

      expect(result.bin).toBe("node");
    });

    it("accepts all allowed binaries", () => {
      for (const bin of ALLOWED_BINARIES) {
        const result = parseCommand(`${bin} --version`);
        expect(result.bin).toBe(bin);
      }
    });

    it("rejects empty command", () => {
      expect(() => parseCommand("")).toThrow();
      expect(() => parseCommand("   ")).toThrow();
    });

    it("rejects disallowed metacharacters", () => {
      expect(() => parseCommand("bun && rm")).toThrow();
      expect(() => parseCommand("bun | cat")).toThrow();
      expect(() => parseCommand("bun; rm")).toThrow();
      expect(() => parseCommand("`rm`")).toThrow();
      expect(() => parseCommand("$(rm)")).toThrow();
      expect(() => parseCommand("<file")).toThrow();
      expect(() => parseCommand(">file")).toThrow();
      expect(() => parseCommand("\n")).toThrow();
      expect(() => parseCommand("\r")).toThrow();
    });

    it("handles quoted arguments", () => {
      const result = parseCommand('bun "install --force"');

      expect(result.bin).toBe("bun");
      expect(result.argv).toEqual(["install --force"]);
    });

    it("handles single quoted arguments", () => {
      const result = parseCommand(`bun 'install --force'`);

      expect(result.bin).toBe("bun");
      expect(result.argv).toEqual(["install --force"]);
    });
  });

  describe("isAllowedBinary", () => {
    it("validates allowed binaries", () => {
      expect(isAllowedBinary("bun")).toBe(true);
      expect(isAllowedBinary("node")).toBe(true);
      expect(isAllowedBinary("npm")).toBe(true);
    });

    it("rejects disallowed binaries", () => {
      expect(isAllowedBinary("rm")).toBe(false);
      expect(isAllowedBinary("curl")).toBe(false);
      expect(isAllowedBinary("/bin/bash")).toBe(false);
    });
  });
});