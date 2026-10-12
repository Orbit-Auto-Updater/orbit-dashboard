import { ApiError, EMAIL_RE, readJson, route, str } from "@/lib/server/api";
import { createSession } from "@/lib/server/auth";
import { hashPassword, newId } from "@/lib/server/crypto";
import { getDb } from "@/lib/server/db";
import { audit } from "@/lib/server/settings";
import { requireSetupAccess } from "@/lib/server/setup";

export const POST = route(async (req) => {
  requireSetupAccess(req);
  const b = await readJson(req);
  const name = str(b.name, "name", { max: 100 });
  const email = str(b.email, "email", { max: 254, pattern: EMAIL_RE }).toLowerCase();
  const password = str(b.password, "password", { min: 10, max: 500 });
  const db = await getDb();
  if ((await db.selectFrom("users").select("id").limit(1).execute()).length) throw new ApiError(409, "An owner account already exists");
  const id = newId("usr");
  await db
    .insertInto("users")
    .values({ id, name, email, password_hash: await hashPassword(password), role_id: "owner", status: "active", invite_token_hash: null, invite_expires_at: null, timezone: null, created_at: Date.now(), last_active_at: null })
    .execute();
  await createSession(db, id, req);
  await audit(db, { id, name }, "user.created", name, "Owner account created during setup");
  return { ok: true };
});
