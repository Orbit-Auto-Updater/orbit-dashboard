/**
 * Test helpers: fresh in-memory databases for both supported engines.
 * PostgreSQL runs in-process through PGlite (Postgres compiled to WASM).
 */
import { PGlite } from "@electric-sql/pglite";
import { Kysely, PostgresDialect } from "kysely";
import { createDb } from "./db";
import { migrateToLatest } from "./migrations";
import type { DB } from "./schema";

export type Engine = "sqlite" | "postgres";

function pglitePool(pgl: PGlite) {
  // Minimal pg.Pool look-alike for Kysely's PostgresDialect.
  const client = {
    async query(text: string, params: unknown[] = []) {
      const r = await pgl.query<Record<string, unknown>>(text, params as never[]);
      const command = text.trim().split(/\s+/)[0]?.toUpperCase();
      // Match pg's int8 parser configured in db.ts.
      const rows = r.rows.map((row) => {
        for (const k of Object.keys(row)) if (typeof row[k] === "bigint") row[k] = Number(row[k]);
        return row;
      });
      return { rows, rowCount: r.affectedRows ?? rows.length, command };
    },
    release() {},
  };
  return { connect: async () => client, end: async () => pgl.close() };
}

export async function testDb(engine: Engine): Promise<Kysely<DB>> {
  const db =
    engine === "sqlite"
      ? createDb({ engine: "sqlite", path: ":memory:" })
      : new Kysely<DB>({ dialect: new PostgresDialect({ pool: pglitePool(new PGlite()) as never }) });
  await migrateToLatest(db);
  return db;
}

export const ENGINES: Engine[] = ["sqlite", "postgres"];
