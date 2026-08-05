import { Elysia, t } from "elysia";
import { databaseCatalogService } from "../services/database-catalog-service";

export const databaseRoutes = new Elysia()
  .get(
    "/databases/:engine",
    ({ params }) => databaseCatalogService.listDatabases(params.engine),
    {
      params: t.Object({
        engine: t.Union([
          t.Literal("mongo"),
          t.Literal("postgres"),
          t.Literal("redis"),
        ]),
      }),
    },
  )
  // Compatibility alias. Remove after backend clients migrate to /databases/mongo.
  .get("/mongo/databases", () =>
    databaseCatalogService.listDatabases("mongo"),
  );
