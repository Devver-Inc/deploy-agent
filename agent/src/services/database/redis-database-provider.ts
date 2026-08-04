import { createClient } from "redis";
import { config } from "../../config";
import {
  databaseUnavailable,
  missingDatabaseConnection,
  type DatabaseProvider,
  type RedisDatabaseInfo,
} from "./database-provider";

const KEYSPACE_LINE = /^db(\d+):keys=(\d+),expires=(\d+)/;

export class RedisDatabaseProvider implements DatabaseProvider {
  readonly engine = "redis" as const;

  async listDatabases(): Promise<RedisDatabaseInfo[]> {
    const connectionString = config.databases.redis?.trim();
    if (!connectionString) {
      throw missingDatabaseConnection(
        this.engine,
        "DEVVER_REDIS_CONNECTION_STRING",
      );
    }

    const client = createClient({
      url: connectionString,
      socket: { connectTimeout: 10_000 },
    });
    client.on("error", () => undefined);

    try {
      await client.connect();
      const [keyspace, settings] = await Promise.all([
        client.info("keyspace"),
        client.configGet("databases"),
      ]);
      const databaseCount = Number(settings.databases);
      if (!Number.isInteger(databaseCount) || databaseCount < 1) {
        throw new Error("Redis returned an invalid database count.");
      }

      const databaseStats = new Map(
        keyspace
          .split("\n")
          .map((line) => line.trim().match(KEYSPACE_LINE))
          .filter((match): match is RegExpMatchArray => match !== null)
          .map((match) => [
            Number(match[1]),
            {
              keyCount: Number(match[2]),
              expiringKeyCount: Number(match[3]),
            },
          ] as const),
      );

      return Array.from({ length: databaseCount }, (_, index) => ({
        name: `db${index}`,
        keyCount: databaseStats.get(index)?.keyCount ?? 0,
        expiringKeyCount: databaseStats.get(index)?.expiringKeyCount ?? 0,
      }));
    } catch (error: unknown) {
      throw databaseUnavailable(this.engine, error);
    } finally {
      if (client.isOpen) await client.close().catch(() => undefined);
    }
  }
}
