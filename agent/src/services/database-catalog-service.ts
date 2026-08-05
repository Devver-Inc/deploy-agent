import {
  ApplicationError,
  ApplicationFailureKind,
} from "../errors/application-error";
import {
  databaseUnavailable,
  type DatabaseEngine,
  type DatabaseInfo,
  type DatabaseProvider,
} from "./database/database-provider";
import { MongoDatabaseProvider } from "./database/mongo-database-provider";
import { PostgresDatabaseProvider } from "./database/postgres-database-provider";
import { RedisDatabaseProvider } from "./database/redis-database-provider";

export class DatabaseCatalogService {
  private readonly providers: ReadonlyMap<DatabaseEngine, DatabaseProvider>;

  constructor(providers: DatabaseProvider[]) {
    this.providers = new Map(
      providers.map((provider) => [provider.engine, provider]),
    );
  }

  async listDatabases(engine: DatabaseEngine): Promise<DatabaseInfo[]> {
    const provider = this.providers.get(engine);
    if (!provider) {
      throw new ApplicationError(
        ApplicationFailureKind.VALIDATION,
        `Unsupported database engine: ${engine}.`,
        { code: "UNSUPPORTED_DATABASE_ENGINE" },
      );
    }

    try {
      return await provider.listDatabases();
    } catch (error: unknown) {
      if (error instanceof ApplicationError) throw error;
      throw databaseUnavailable(engine, error);
    }
  }
}

export const databaseCatalogService = new DatabaseCatalogService([
  new MongoDatabaseProvider(),
  new PostgresDatabaseProvider(),
  new RedisDatabaseProvider(),
]);
