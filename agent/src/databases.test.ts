import { describe, expect, test } from "bun:test";
import { checkUrl, parseKeyspace } from "./databases";

describe("parseKeyspace", () => {
  test("one entry per non-empty logical database", () => {
    const info = "# Keyspace\r\ndb0:keys=12,expires=0,avg_ttl=0\r\ndb3:keys=1,expires=1,avg_ttl=500\r\n";
    expect(parseKeyspace(info)).toEqual([{ name: "0", keys: 12 }, { name: "3", keys: 1 }]);
  });

  test("an empty server has no database", () => {
    expect(parseKeyspace("# Keyspace\r\n")).toEqual([]);
  });
});

describe("checkUrl", () => {
  test("accepts each engine's scheme", () => {
    expect(checkUrl("mongo", "mongodb://u:p@h:27017/admin").username).toBe("u");
    expect(checkUrl("postgres", "postgres://u:p@h:5432/db").hostname).toBe("h");
    expect(checkUrl("postgres", "postgresql://u:p@h:5432/db").hostname).toBe("h");
    expect(checkUrl("valkey", "redis://:p@h:6379/0").password).toBe("p");
  });

  test("refuses another engine's or a broken connection string", () => {
    expect(() => checkUrl("postgres", "mongodb://u:p@h/db")).toThrow("Not a postgres connection string.");
    expect(() => checkUrl("valkey", "not a url")).toThrow("Not a valkey connection string.");
  });
});
