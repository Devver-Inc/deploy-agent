import { MongoClient } from "mongodb";
import { config } from "./config";
import { AgentError } from "./errors";

const INTERNAL_DATABASES = new Set(["admin", "config", "local"]);

export async function listMongoDatabases() {
  if (!config.mongoUrl) {
    throw new AgentError(500, "DATABASE_NOT_CONFIGURED", "DEVVER_MONGO_CONNECTION_STRING is not set.");
  }
  const client = new MongoClient(config.mongoUrl, { serverSelectionTimeoutMS: 10_000 });
  try {
    const { databases } = await client.db("admin").admin().listDatabases();
    return databases
      .filter(({ name }) => !INTERNAL_DATABASES.has(name))
      .map(({ name, sizeOnDisk = 0, empty = false }) => ({ name, sizeOnDisk, empty }));
  } catch (error) {
    throw new AgentError(502, "DATABASE_UNAVAILABLE", `Mongo is unreachable: ${String(error)}`);
  } finally {
    await client.close();
  }
}
