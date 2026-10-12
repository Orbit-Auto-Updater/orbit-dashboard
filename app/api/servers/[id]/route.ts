import { notFound, oneOf, readJson, route, str } from "@/lib/server/api";
import { requireUser } from "@/lib/server/auth";
import { getDb } from "@/lib/server/db";
import { RANGES, serverDetail, type Range } from "@/lib/server/queries";
import { audit } from "@/lib/server/settings";

type Ctx = { params: Promise<{ id: string }> };

export const GET = route<Ctx>(async (req, { params }) => {
  await requireUser("metrics.view");
  const { id } = await params;
  const r = new URL(req.url).searchParams.get("range") ?? "live";
  const detail = await serverDetail(await getDb(), id, (r in RANGES ? r : "live") as Range);
  if (!detail) throw notFound("Server not found");
  return detail;
});

export const PATCH = route<Ctx>(async (req, { params }) => {
  const user = await requireUser("servers.manage");
  const { id } = await params;
  const b = await readJson(req);
  const db = await getDb();
  const server = await db.selectFrom("servers").select("hostname").where("id", "=", id).executeTakeFirst();
  if (!server) throw notFound("Server not found");
  await db
    .updateTable("servers")
    .set({
      display_name: str(b.displayName, "displayName", { optional: true, max: 100 }) || null,
      environment: oneOf(b.environment, "environment", ["production", "staging", "development"] as const),
      ssh_user: str(b.sshUser, "sshUser", { optional: true, max: 32, pattern: /^[a-z_][a-z0-9_-]*$/ }) || null,
    })
    .where("id", "=", id)
    .execute();
  await audit(db, user, "server.updated", server.hostname);
  return { ok: true };
});

export const DELETE = route<Ctx>(async (_req, { params }) => {
  const user = await requireUser("servers.manage");
  const { id } = await params;
  const db = await getDb();
  const server = await db.selectFrom("servers").select("hostname").where("id", "=", id).executeTakeFirst();
  if (!server) throw notFound("Server not found");
  await db.deleteFrom("alerts").where("server_id", "=", id).execute();
  await db.deleteFrom("servers").where("id", "=", id).execute();
  await audit(db, user, "server.removed", server.hostname, "The agent's credentials no longer work; uninstall it from the host.");
  return { ok: true };
});
