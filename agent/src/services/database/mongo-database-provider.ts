import { MongoClient } from "mongodb";
import { config } from "../../config";
import {
  databaseUnavailable,
  missingDatabaseConnection,
  type DatabaseProvider,
  type MongoDatabaseInfo,
} from "./database-provider";

const INTERNAL_DATABASES = new Set(["admin", "config", "local"]);

export class MongoDatabaseProvider implements DatabaseProvider {
  readonly engine = "mongo" as const;

  async listDatabases(): Promise<MongoDatabaseInfo[]> {
    const connectionString = config.databases.mongo?.trim();
    if (!connectionString) {
      throw missingDatabaseConnection(
        this.engine,
        "DEVVER_MONGO_CONNECTION_STRING",
      );
    }

    const client = new MongoClient(connectionString, {
      serverSelectionTimeoutMS: 10_000,
    });

    try {
      await client.connect();
      const { databases } = await client.db("admin").admin().listDatabases();
      return databases
        .filter(({ name }) => !INTERNAL_DATABASES.has(name))
        .map(({ name, sizeOnDisk = 0, empty = false }) => ({
          name,
          sizeOnDisk,
          empty,
        }));
    } catch (error: unknown) {
      throw databaseUnavailable(this.engine, error);
    } finally {
      await client.close();
    }
  }
}
