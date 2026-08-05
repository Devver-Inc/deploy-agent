import {
  ApplicationError,
  ApplicationFailureKind,
} from "../../errors/application-error";

export const DATABASE_ENGINES = ["mongo", "postgres", "redis"] as const;

export type DatabaseEngine = (typeof DATABASE_ENGINES)[number];

export interface MongoDatabaseInfo {
  name: string;
  sizeOnDisk: number;
  empty: boolean;
}

export interface PostgresDatabaseInfo {
  name: string;
  sizeOnDisk: number;
}

export interface RedisDatabaseInfo {
  name: string;
  keyCount: number;
  expiringKeyCount: number;
}

export type DatabaseInfo =
  | MongoDatabaseInfo
  | PostgresDatabaseInfo
  | RedisDatabaseInfo;

export interface DatabaseProvider {
  readonly engine: DatabaseEngine;
  listDatabases(): Promise<DatabaseInfo[]>;
}

export function missingDatabaseConnection(
  engine: DatabaseEngine,
  variable: string,
): ApplicationError {
  return new ApplicationError(
    ApplicationFailureKind.CONFIGURATION,
    `${engine} connection string is not configured.`,
    {
      code: "DATABASE_CONFIGURATION_ERROR",
      details: `Set ${variable} in the deploy-agent pod.`,
    },
  );
}

export function databaseUnavailable(
  engine: DatabaseEngine,
  error: unknown,
): ApplicationError {
  return new ApplicationError(
    ApplicationFailureKind.UPSTREAM,
    `${engine} instance is unreachable.`,
    {
      code: "DATABASE_INSTANCE_UNREACHABLE",
      details: error instanceof Error ? error.message : String(error),
      cause: error,
    },
  );
}
