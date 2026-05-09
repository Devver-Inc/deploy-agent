import { MongoClient, MongoServerError } from "mongodb";
import { config } from "../config";
import { ApiError } from "../utils/api-error";
import type { MongoDatabaseInfo } from "../types";

const INTERNAL_DATABASES = new Set(["admin", "config", "local"]);

export class MongoInstanceService {
  async listDatabases(): Promise<MongoDatabaseInfo[]> {
    const connectionString = this.resolveConnectionString();
    const client = new MongoClient(connectionString, {
      serverSelectionTimeoutMS: 10000,
    });

    try {
      await client.connect();
      const { databases } = await client.db("admin").admin().listDatabases();
      return databases
        .filter((database) => !INTERNAL_DATABASES.has(database.name))
        .map((database) => ({
          name: database.name,
          sizeOnDisk: database.sizeOnDisk ?? 0,
          empty: database.empty ?? false,
        }));
    } catch (error) {
      const details = error instanceof Error ? error.message : String(error);
      const message =
        error instanceof MongoServerError
          ? "Mongo instance rejected the request."
          : "Mongo instance is unreachable.";
      throw new ApiError(
        "MONGO_INSTANCE_UNREACHABLE",
        502,
        message,
        details,
      );
    } finally {
      await client.close();
    }
  }

  private resolveConnectionString(): string {
    if (config.mongo.connectionString?.trim()) {
      return config.mongo.connectionString.trim();
    }

    throw new ApiError(
      "MONGO_CONFIGURATION_ERROR",
      500,
      "Mongo connection string is not configured.",
      "Set DEVVER_MONGO_CONNECTION_STRING in the deploy-agent pod.",
    );
  }
}

export const mongoInstanceService = new MongoInstanceService();
