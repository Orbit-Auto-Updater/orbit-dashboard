/**
 * Database access. One Kysely instance per process (kept on globalThis so dev
 * hot reloads don't leak connections), migrated to the latest schema before
 * first use.
 */
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { Kysely, PostgresDialect, SqliteDialect, sql, type SqliteDatabase } from "kysely";
import pg from "pg";
import { getDbConfig, type DbConfig } from "./config";
import { migrateToLatest, migrations } from "./migrations";
import type { DB } from "./schema";

export class NotConfiguredError extends Error {
  constructor() {
    super("The database has not been configured yet. Open /setup to finish installation.");
  }
}

// int8 (bigint) columns hold epoch-ms timestamps; return them as numbers.
pg.types.setTypeParser(20, (v) => Number(v));
pg.types.setTypeParser(1700, (v) => Number(v));

/** Adapts Node's built-in node:sqlite to the interface Kysely's SqliteDialect expects. */
function nodeSqlite(file: string): SqliteDatabase {
  if (file !== ":memory:") {
    fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
    // The database holds password hashes and tokens: create it private
    // (SQLite gives its -wal/-shm files the same mode).
    if (!fs.existsSync(file)) fs.writeFileSync(file, "", { mode: 0o600 });
  }
  const db = new DatabaseSync(file);
  db.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000; PRAGMA synchronous = NORMAL;");
  type Bindable = null | number | bigint | string | Uint8Array;
  const bind = (params: ReadonlyArray<unknown>): Bindable[] =>
    params.map((v) => {
      if (v === undefined) return null;
      if (typeof v === "boolean") return v ? 1 : 0;
      if (v instanceof Date) return v.getTime();
      return v as Bindable;
    });
  return {
    close: () => db.close(),
    prepare(sqlText: string) {
      const st = db.prepare(sqlText);
      return {
        reader: st.columns().length > 0,
        all: (p: ReadonlyArray<unknown>) => st.all(...bind(p)) as unknown[],
        run: (p: ReadonlyArray<unknown>) => {
          const r = st.run(...bind(p));
          return { changes: r.changes, lastInsertRowid: r.lastInsertRowid };
        },
        iterate: (p: ReadonlyArray<unknown>) => st.iterate(...bind(p)) as IterableIterator<unknown>,
      };
    },
  };
}

export function createDb(cfg: DbConfig): Kysely<DB> {
  if (cfg.engine === "sqlite") {
    return new Kysely<DB>({ dialect: new SqliteDialect({ database: nodeSqlite(cfg.path) }) });
  }
  const ssl = cfg.ssl === "verify-full" ? { rejectUnauthorized: true } : cfg.ssl === "require" ? { rejectUnauthorized: false } : undefined;
  const pool = new pg.Pool({ connectionString: cfg.url, ssl, max: 10, idleTimeoutMillis: 30_000, connectionTimeoutMillis: 10_000 });
  return new Kysely<DB>({ dialect: new PostgresDialect({ pool }) });
}

type Cached = { key: string; db: Kysely<DB>; ready: Promise<void> };
const g = globalThis as unknown as { __linuxDashDb?: Cached };

export async function getDb(): Promise<Kysely<DB>> {
  const cfg = getDbConfig();
  if (!cfg) throw new NotConfiguredError();
  // The migration list is part of the key: when code with a new migration is
  // loaded (dev hot reload, or a long-running process) it gets applied.
  const key = JSON.stringify(cfg) + "|" + Object.keys(migrations).join(",");
  if (g.__linuxDashDb?.key !== key) {
    const old = g.__linuxDashDb;
    const db = createDb(cfg);
    g.__linuxDashDb = { key, db, ready: migrateToLatest(db).then(() => (cfg.engine === "sqlite" ? compactIfBloated(db) : undefined)) };
    old?.db.destroy().catch(() => {});
  }
  const cur = g.__linuxDashDb!;
  try {
    await cur.ready;
  } catch (err) {
    if (g.__linuxDashDb === cur) g.__linuxDashDb = undefined; // retry next time
    throw err;
  }
  return cur.db;
}

/** Reclaim space after large deletions (e.g. the OSV cache trim in migration 003). */
async function compactIfBloated(db: Kysely<DB>) {
  const pragma = async (name: "page_count" | "freelist_count") => Number(Object.values((await sql.raw(`pragma ${name}`).execute(db)).rows[0] ?? {})[0] ?? 0);
  const [pages, free] = [await pragma("page_count"), await pragma("freelist_count")];
  if (free > 25_000 && free > pages * 0.3) {
    console.log(`[db] compacting SQLite database (${Math.round((free * 4096) / 1048576)} MB unused)…`);
    await sql`vacuum`.execute(db);
  }
}

/** Open a connection with the given settings and run a trivial query. */
export async function testConnection(cfg: DbConfig): Promise<{ ok: true; version: string } | { ok: false; error: string }> {
  const db = createDb(cfg);
  try {
    const q =
      cfg.engine === "sqlite"
        ? sql<{ version: string }>`select 'SQLite ' || sqlite_version() as version`
        : sql<{ version: string }>`select version() as version`;
    const { rows } = await q.execute(db);
    return { ok: true, version: rows[0]?.version ?? "" };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  } finally {
    await db.destroy().catch(() => {});
  }
}

export { sql };
