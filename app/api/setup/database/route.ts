import fs from "node:fs";
import path from "node:path";
import { badRequest, int, oneOf, readJson, route, str } from "@/lib/server/api";
import { envDatabase, parseDatabaseUrl, writeConfig, type DbConfig } from "@/lib/server/config";
import { getDb, testConnection } from "@/lib/server/db";
import { listTables } from "@/lib/server/migrations";
import { describeDb, requireSetupAccess } from "@/lib/server/setup";

function buildConfig(b: Record<string, unknown>): DbConfig {
  const engine = oneOf(b.engine, "engine", ["sqlite", "postgres"] as const);
  if (engine === "sqlite") {
    const p = path.resolve(str(b.sqlitePath, "sqlitePath", { max: 1000 }));
    if (fs.existsSync(p) && fs.statSync(p).isDirectory()) throw badRequest("That path is a directory; give a file name", { sqlitePath: "Is a directory" });
    return { engine, path: p };
  }
  const ssl = oneOf(b.ssl ?? "disable", "ssl", ["disable", "require", "verify-full"] as const);
  const url = str(b.url, "url", { optional: true, max: 2000 });
  if (url) {
    const cfg = parseDatabaseUrl(url);
    if (!cfg || cfg.engine !== "postgres") throw badRequest("Connection URL must start with postgres://", { url: "Must start with postgres://" });
    return { ...cfg, ssl };
  }
  const host = str(b.host, "host", { max: 255, pattern: /^[A-Za-z0-9.\-:[\]]+$/ });
  const port = int(b.port ?? 5432, "port", 1, 65535);
  const database = str(b.database, "database", { max: 63 });
  const user = str(b.user, "user", { max: 63 });
  const password = typeof b.password === "string" ? b.password : "";
  const auth = `${encodeURIComponent(user)}${password ? ":" + encodeURIComponent(password) : ""}@`;
  return { engine, url: `postgres://${auth}${host}:${port}/${encodeURIComponent(database)}`, ssl };
}

export const POST = route(async (req) => {
  requireSetupAccess(req);
  const b = await readJson(req);
  const action = oneOf(b.action, "action", ["test", "save"] as const);
  const env = envDatabase();
  const cfg = env ?? buildConfig(b);

  const test = await testConnection(cfg);
  if (!test.ok) return { ok: false, error: test.error, target: describeDb(cfg) };
  if (action === "test") return { ok: true, version: test.version, target: describeDb(cfg) };

  if (!env) writeConfig({ database: cfg, setupComplete: false });
  const db = await getDb(); // runs migrations: creates every table
  return { ok: true, version: test.version, target: describeDb(cfg), tables: await listTables(db) };
});
