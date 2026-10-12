import { route } from "@/lib/server/api";
import { requireUser } from "@/lib/server/auth";
import { getDb } from "@/lib/server/db";

export const GET = route(async () => {
  const user = await requireUser();
  const db = await getDb();
  const rows = await db.selectFrom("sessions").select(["id", "created_at", "last_seen_at", "ip", "user_agent"]).where("user_id", "=", user.id).where("expires_at", ">", Date.now()).orderBy("last_seen_at", "desc").execute();
  return { sessions: rows.map((s) => ({ ...s, current: s.id === user.sessionId })) };
});

export const DELETE = route(async () => {
  const user = await requireUser();
  const db = await getDb();
  await db.deleteFrom("sessions").where("user_id", "=", user.id).where("id", "!=", user.sessionId).execute();
  return { ok: true };
});
