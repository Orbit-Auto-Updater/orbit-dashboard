import { ApiError, EMAIL_RE, readJson, route, str } from "@/lib/server/api";
import { requireUser } from "@/lib/server/auth";
import { newId } from "@/lib/server/crypto";
import { getDb } from "@/lib/server/db";
import { audit } from "@/lib/server/settings";
import { newInvite } from "@/lib/server/users";

export const GET = route(async () => {
  await requireUser("users.manage");
  const db = await getDb();
  const users = await db
    .selectFrom("users")
    .innerJoin("roles", "roles.id", "users.role_id")
    .select(["users.id", "users.name", "users.email", "users.role_id", "roles.name as role_name", "users.status", "users.invite_expires_at", "users.created_at", "users.last_active_at"])
    .orderBy("users.created_at")
    .execute();
  return { users };
});

export const POST = route(async (req) => {
  const actor = await requireUser("users.manage");
  const b = await readJson(req);
  const name = str(b.name, "name", { max: 100 });
  const email = str(b.email, "email", { max: 254, pattern: EMAIL_RE }).toLowerCase();
  const roleId = str(b.roleId, "roleId", { max: 64 });
  const db = await getDb();
  if (!(await db.selectFrom("roles").select("id").where("id", "=", roleId).executeTakeFirst())) throw new ApiError(400, "Unknown role", { roleId: "Unknown role" });
  if (roleId === "owner" && actor.role !== "owner") throw new ApiError(403, "Only an owner can invite another owner");
  if (await db.selectFrom("users").select("id").where("email", "=", email).executeTakeFirst()) throw new ApiError(409, "A user with that email already exists", { email: "Already exists" });
  const id = newId("usr");
  await db.insertInto("users").values({ id, name, email, password_hash: null, role_id: roleId, status: "invited", invite_token_hash: null, invite_expires_at: null, timezone: null, created_at: Date.now(), last_active_at: null }).execute();
  const inviteUrl = await newInvite(db, id, req);
  await audit(db, actor, "user.invited", email, `role ${roleId}`);
  return { id, inviteUrl };
});
