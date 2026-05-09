import { existsSync, readFileSync } from "fs";
import { MongoClient, MongoServerError } from "mongodb";
import { config } from "../config";
import { ApiError } from "../utils/api-error";
import type { MongoDatabaseInfo } from "../types";

const INTERNAL_DATABASES = new Set(["admin", "config", "local"]);

interface ListMongoDatabasesInput {
  orgSlug: string;
  projectSlug: string;
}

export class MongoInstanceService {
  async listDatabases({
    orgSlug,
    projectSlug,
  }: ListMongoDatabasesInput): Promise<MongoDatabaseInfo[]> {
    const host = this.buildHost(orgSlug, projectSlug);
    const connectionString = this.resolveConnectionString();
    const caFile = this.resolveCaFile();

    const client = new MongoClient(connectionString, {
      authSource: "admin",
      serverSelectionTimeoutMS: 10000,
      tls: true,
      ...(caFile ? { tlsCAFile: caFile } : {}),
      ...(!caFile && config.mongo.tlsAllowInvalidCertificates
        ? { tlsAllowInvalidCertificates: true }
        : {}),
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
          ? `Mongo instance rejected the request for '${host}'.`
          : `Mongo instance for '${host}' is unreachable.`;
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

  private buildHost(orgSlug: string, projectSlug: string): string {
    return `${orgSlug}-${projectSlug}-mongo:${config.mongo.port}`;
  }

  private resolveConnectionString(): string {
    const fileValue = this.resolveFileValue(config.mongo.connectionStringFile);
    if (fileValue) {
      return fileValue;
    }

    if (config.mongo.connectionString?.trim()) {
      return config.mongo.connectionString.trim();
    }

    throw new ApiError(
      "MONGO_CONFIGURATION_ERROR",
      500,
      "Mongo connection string is not configured.",
      "Set DEVVER_MONGO_CONNECTION_STRING_FILE in the pod or DEVVER_MONGO_CONNECTION_STRING for local development.",
    );
  }

  private resolveCaFile(): string | undefined {
    return existsSync(config.mongo.caFile) ? config.mongo.caFile : undefined;
  }

  private resolveFileValue(filePath?: string): string | undefined {
    if (!filePath || !existsSync(filePath)) {
      return undefined;
    }

    const value = readFileSync(filePath, "utf8").trim();
    return value || undefined;
  }
}

export const mongoInstanceService = new MongoInstanceService();
