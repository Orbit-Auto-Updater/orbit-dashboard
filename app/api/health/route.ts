import { connection } from "next/server";
import { getDbConfig, isSetupComplete } from "@/lib/server/config";
import { getDb, sql } from "@/lib/server/db";

/**
 * Liveness/readiness probe for containers and load balancers. Unauthenticated
 * and deliberately terse: it reveals only whether the app and its database work.
 */
export async function GET() {
  await connection();
  const headers = { "Cache-Control": "no-store" };
  if (!getDbConfig()) return Response.json({ status: "ok", setup: "pending", database: "not-configured" }, { headers });
  try {
    const db = await getDb();
    await sql`select 1`.execute(db);
    return Response.json({ status: "ok", setup: isSetupComplete() ? "complete" : "pending", database: "ok" }, { headers });
  } catch {
    return Response.json({ status: "error", database: "unreachable" }, { status: 503, headers });
  }
}
