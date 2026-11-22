import { RedisClient, SQL } from "bun";
import { MongoClient } from "mongodb";
import { AgentError } from "./errors";

export const ENGINES = ["mongo", "postgres", "valkey"] as const;
export type Engine = (typeof ENGINES)[number];

export const POSTGRES_NAME_PATTERN = "^[a-z_][a-z0-9_]{0,62}$";
export const PASSWORD_PATTERN = "^[0-9a-f]{32,128}$";

export interface DatabaseInfo {
  name: string;
  sizeOnDisk?: number;
  keys?: number;
}

const SCHEMES: Record<Engine, RegExp> = {
  mongo: /^mongodb:\/\//,
  postgres: /^postgres(ql)?:\/\//,
  valkey: /^redis:\/\//,
};
const MONGO_INTERNAL = new Set(["admin", "config", "local"]);
const TIMEOUT_MS = 10_000;

export function checkUrl(engine: Engine, url: string): URL {
  let parsed: URL | undefined;
  try {
    parsed = new URL(url);
  } catch {}
  if (!parsed || !SCHEMES[engine].test(url)) {
    throw new AgentError(422, "INVALID_CONNECTION_STRING", `Not a ${engine} connection string.`);
  }
  return parsed;
}

/** `INFO keyspace` → one entry per non-empty logical database ("db3:keys=12,expires=0,..."). */
export function parseKeyspace(info: string): DatabaseInfo[] {
  return [...info.matchAll(/^db(\d+):keys=(\d+)/gm)].map(([, name, keys]) => ({ name: name!, keys: Number(keys) }));
}

async function reach<T>(engine: Engine, work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (error) {
    if (error instanceof AgentError) throw error;
    throw new AgentError(502, "DATABASE_UNAVAILABLE", `${engine}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

async function withMongo<T>(url: string, work: (client: MongoClient) => Promise<T>): Promise<T> {
  const client = new MongoClient(url, { serverSelectionTimeoutMS: TIMEOUT_MS });
  try {
    return await work(client);
  } finally {
    await client.close();
  }
}

async function withPostgres<T>(url: string, work: (sql: SQL) => Promise<T>): Promise<T> {
  const sql = new SQL({ url, max: 1, connectionTimeout: TIMEOUT_MS / 1000 });
  try {
    return await work(sql);
  } finally {
    await sql.close();
  }
}

async function withValkey<T>(url: string, work: (client: RedisClient) => Promise<T>): Promise<T> {
  const client = new RedisClient(url, { connectionTimeout: TIMEOUT_MS, autoReconnect: false });
  try {
    return await work(client);
  } finally {
    client.close();
  }
}

export function list(engine: Engine, url: string): Promise<DatabaseInfo[]> {
  checkUrl(engine, url);
  return reach(engine, async () => {
    if (engine === "mongo") {
      const { databases } = await withMongo(url, (c) => c.db("admin").admin().listDatabases());
      return databases
        .filter(({ name }) => !MONGO_INTERNAL.has(name))
        .map(({ name, sizeOnDisk = 0 }) => ({ name, sizeOnDisk }));
    }
    if (engine === "postgres") {
      const rows: { name: string; size: string }[] = await withPostgres(url, (sql) => sql`
        SELECT datname AS name, pg_database_size(datname)::text AS size FROM pg_database
        WHERE NOT datistemplate AND datname <> 'postgres' ORDER BY datname`);
      return rows.map(({ name, size }) => ({ name, sizeOnDisk: Number(size) }));
    }
    return parseKeyspace(await withValkey(url, (c) => c.send("INFO", ["keyspace"])));
  });
}

export function createPostgresDatabase(url: string, name: string): Promise<void> {
  checkUrl("postgres", url);
  return reach("postgres", () =>
    withPostgres(url, async (sql) => {
      const [exists] = await sql`SELECT 1 FROM pg_database WHERE datname = ${name}`;
      if (exists) return;
      // An identifier cannot be a parameter; `name` matches POSTGRES_NAME_PATTERN.
      await sql.unsafe(`CREATE DATABASE "${name}"`).catch((error: { errno?: string }) => {
        // Created by a concurrent call: duplicate_database, or unique_violation on the catalog.
        if (error.errno !== "42P04" && error.errno !== "23505") throw error;
      });
    }),
  );
}

/** Sets the password of the user `url` logs in with; `url` still holds the current one. */
export function setPassword(engine: Engine, url: string, password: string): Promise<void> {
  const user = decodeURIComponent(checkUrl(engine, url).username);
  return reach(engine, async () => {
    if (engine === "mongo") {
      await withMongo(url, (c) => c.db("admin").command({ updateUser: user, pwd: password }));
    } else if (engine === "postgres") {
      if (!new RegExp(POSTGRES_NAME_PATTERN).test(user)) {
        throw new AgentError(422, "INVALID_CONNECTION_STRING", "Unexpected Postgres user name.");
      }
      // ALTER USER takes no parameters; `password` matches PASSWORD_PATTERN (hex).
      await withPostgres(url, (sql) => sql.unsafe(`ALTER USER "${user}" PASSWORD '${password}'`));
    } else {
      await withValkey(url, (c) => c.send("CONFIG", ["SET", "requirepass", password]));
    }
  });
}
