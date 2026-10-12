import { ApiError, readJson, route, str } from "@/lib/server/api";
import { requireUser } from "@/lib/server/auth";
import { hashPassword, verifyPassword } from "@/lib/server/crypto";
import { getDb } from "@/lib/server/db";
import { audit } from "@/lib/server/settings";

export const POST = route(async (req) => {
  const user = await requireUser();
  const body = await readJson(req);
  const current = str(body.current, "current", { max: 500 });
  const next = str(body.next, "next", { min: 10, max: 500 });
  const db = await getDb();
  const row = await db.selectFrom("users").select("password_hash").where("id", "=", user.id).executeTakeFirstOrThrow();
  if (!(await verifyPassword(current, row.password_hash))) throw new ApiError(400, "Current password is incorrect", { current: "Incorrect" });
  await db.updateTable("users").set({ password_hash: await hashPassword(next) }).where("id", "=", user.id).execute();
  // Sign out every other session.
  await db.deleteFrom("sessions").where("user_id", "=", user.id).where("id", "!=", user.sessionId).execute();
  await audit(db, user, "user.password_changed", user.name);
  return { ok: true };
});
