import { Client } from "pg";
import { config } from "../../config";
import {
  databaseUnavailable,
  missingDatabaseConnection,
  type DatabaseProvider,
  type PostgresDatabaseInfo,
} from "./database-provider";

interface PostgresDatabaseRow {
  name: string;
  size_on_disk: string;
}

const POSTGRES_TIMEOUT_MS = 10_000;

export class PostgresDatabaseProvider implements DatabaseProvider {
  readonly engine = "postgres" as const;

  async listDatabases(): Promise<PostgresDatabaseInfo[]> {
    const connectionString = config.databases.postgres?.trim();
    if (!connectionString) {
      throw missingDatabaseConnection(
        this.engine,
        "DEVVER_POSTGRES_CONNECTION_STRING",
      );
    }

    const client = new Client({
      connectionString,
      connectionTimeoutMillis: POSTGRES_TIMEOUT_MS,
      query_timeout: POSTGRES_TIMEOUT_MS,
    });

    try {
      await client.connect();
      const result = await client.query<PostgresDatabaseRow>(`
        SELECT datname AS name, pg_database_size(datname)::text AS size_on_disk
        FROM pg_database
        WHERE datistemplate = false
          AND datallowconn = true
          AND datname <> 'postgres'
        ORDER BY datname
      `);
      return result.rows.map(({ name, size_on_disk }) => ({
        name,
        sizeOnDisk: Number(size_on_disk),
      }));
    } catch (error: unknown) {
      throw databaseUnavailable(this.engine, error);
    } finally {
      await client.end().catch(() => undefined);
    }
  }
}
