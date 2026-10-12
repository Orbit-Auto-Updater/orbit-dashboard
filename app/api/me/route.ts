import { EMAIL_RE, ApiError, readJson, route, str } from "@/lib/server/api";
import { requireUser } from "@/lib/server/auth";
import { getDb } from "@/lib/server/db";
import { getSetting } from "@/lib/server/settings";

export const GET = route(async () => {
  const user = await requireUser();
  const db = await getDb();
  const row = await db.selectFrom("users").select(["created_at", "last_active_at"]).where("id", "=", user.id).executeTakeFirst();
  const { sessionId, ...rest } = user;
  void sessionId;
  return { user: { ...rest, createdAt: row?.created_at ?? null }, orgName: await getSetting(db, "org_name") };
});

export const PATCH = route(async (req) => {
  const user = await requireUser();
  const body = await readJson(req);
  const db = await getDb();
  const name = str(body.name, "name", { max: 100 });
  const email = str(body.email, "email", { max: 254, pattern: EMAIL_RE }).toLowerCase();
  const timezone = str(body.timezone, "timezone", { optional: true, max: 64 }) || null;
  if (timezone) {
    try {
      new Intl.DateTimeFormat("en", { timeZone: timezone });
    } catch {
      throw new ApiError(400, "Unknown timezone", { timezone: "Unknown timezone" });
    }
  }
  const clash = await db.selectFrom("users").select("id").where("email", "=", email).where("id", "!=", user.id).executeTakeFirst();
  if (clash) throw new ApiError(409, "Another user already has that email", { email: "Already in use" });
  await db.updateTable("users").set({ name, email, timezone }).where("id", "=", user.id).execute();
  return { ok: true };
});
