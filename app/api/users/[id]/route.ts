import { ApiError, oneOf, readJson, route } from "@/lib/server/api";
import { requireUser } from "@/lib/server/auth";
import { getDb } from "@/lib/server/db";
import { audit } from "@/lib/server/settings";
import { assertCanManage } from "@/lib/server/users";

type Ctx = { params: Promise<{ id: string }> };

export const PATCH = route<Ctx>(async (req, { params }) => {
  const actor = await requireUser("users.manage");
  const { id } = await params;
  const b = await readJson(req);
  const db = await getDb();
  const roleId = typeof b.roleId === "string" ? b.roleId : undefined;
  const status = b.status === undefined ? undefined : oneOf(b.status, "status", ["active", "suspended"] as const);
  if (roleId && !(await db.selectFrom("roles").select("id").where("id", "=", roleId).executeTakeFirst())) throw new ApiError(400, "Unknown role");
  const target = await assertCanManage(db, actor, id, { roleId, status });
  if (status === "active" && target.status === "invited") throw new ApiError(400, "Invited users become active when they accept their invite");
  await db.updateTable("users").set({ ...(roleId ? { role_id: roleId } : {}), ...(status ? { status } : {}) }).where("id", "=", id).execute();
  if (status === "suspended") await db.deleteFrom("sessions").where("user_id", "=", id).execute();
  await audit(db, actor, "user.updated", id, [roleId && `role → ${roleId}`, status && `status → ${status}`].filter(Boolean).join(", "));
  return { ok: true };
});

export const DELETE = route<Ctx>(async (_req, { params }) => {
  const actor = await requireUser("users.manage");
  const { id } = await params;
  const db = await getDb();
  await assertCanManage(db, actor, id, { remove: true });
  const u = await db.selectFrom("users").select("email").where("id", "=", id).executeTakeFirstOrThrow();
  await db.deleteFrom("users").where("id", "=", id).execute();
  await audit(db, actor, "user.removed", u.email);
  return { ok: true };
});
