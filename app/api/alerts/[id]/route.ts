import { notFound, oneOf, readJson, route } from "@/lib/server/api";
import { requireUser } from "@/lib/server/auth";
import { getDb } from "@/lib/server/db";
import { audit } from "@/lib/server/settings";

export const PATCH = route<{ params: Promise<{ id: string }> }>(async (req, { params }) => {
  const user = await requireUser("alerts.ack");
  const { id } = await params;
  const action = oneOf((await readJson(req)).action, "action", ["acknowledge", "unacknowledge", "resolve"] as const);
  const db = await getDb();
  const a = await db.selectFrom("alerts").select(["title"]).where("id", "=", id).executeTakeFirst();
  if (!a) throw notFound("Alert not found");
  const now = Date.now();
  const set =
    action === "acknowledge" ? { status: "acknowledged" as const, acknowledged_by: user.id, acknowledged_at: now }
    : action === "unacknowledge" ? { status: "open" as const, acknowledged_by: null, acknowledged_at: null }
    : { status: "resolved" as const, resolved_at: now };
  await db.updateTable("alerts").set(set).where("id", "=", id).where("status", "!=", "resolved").execute();
  await audit(db, user, `alert.${action}`, a.title);
  return { ok: true };
});
