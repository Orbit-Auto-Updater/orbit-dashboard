/** First-run setup wizard state. */
import path from "node:path";
import { ApiError } from "./api";
import { checkSetupCode, dataDir, envDatabase, getDbConfig, getSetupCode, isSetupComplete, type DbConfig } from "./config";
import { getDb } from "./db";

export type SetupStep = "database" | "admin" | "organisation" | "done";

export async function setupState(): Promise<{ step: SetupStep; databaseFromEnv: boolean; database: { engine: string; target: string } | null }> {
  const cfg = getDbConfig();
  const database = cfg ? { engine: cfg.engine, target: describeDb(cfg) } : null;
  const databaseFromEnv = envDatabase() !== null;
  if (isSetupComplete()) return { step: "done", databaseFromEnv, database };
  getSetupCode(); // make sure the code exists and has been printed
  if (!cfg) return { step: "database", databaseFromEnv, database };
  try {
    const db = await getDb();
    const users = await db.selectFrom("users").select("id").limit(1).execute();
    return { step: users.length ? "organisation" : "admin", databaseFromEnv, database };
  } catch {
    return { step: "database", databaseFromEnv, database };
  }
}

/** Setup endpoints only work before setup completes, and need the one-time code. */
export function requireSetupAccess(req: Request) {
  if (isSetupComplete()) throw new ApiError(403, "Setup is already complete");
  if (!checkSetupCode(req.headers.get("x-setup-code"))) {
    throw new ApiError(401, "Setup code missing or incorrect. It is printed in the dashboard server's log on startup.", { code: "Incorrect code" });
  }
}

export function describeDb(cfg: DbConfig) {
  if (cfg.engine === "sqlite") return cfg.path;
  try {
    const u = new URL(cfg.url);
    return `${u.username ? u.username + "@" : ""}${u.hostname}${u.port ? ":" + u.port : ""}${u.pathname}`;
  } catch {
    return "PostgreSQL";
  }
}

export const defaultSqlitePath = () => path.join(dataDir(), "linux-dash.db");
