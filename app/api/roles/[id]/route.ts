import { ApiError, readJson, route, str } from "@/lib/server/api";
import { requireUser } from "@/lib/server/auth";
import { getDb } from "@/lib/server/db";
import { audit } from "@/lib/server/settings";
import { isPermission } from "@/lib/permissions";

type Ctx = { params: Promise<{ id: string }> };

export const PUT = route<Ctx>(async (req, { params }) => {
  const user = await requireUser("roles.manage");
  const { id } = await params;
  if (id === "owner") throw new ApiError(400, "The owner role always has every permission");
  const b = await readJson(req);
  const db = await getDb();
  const role = await db.selectFrom("roles").selectAll().where("id", "=", id).executeTakeFirst();
  if (!role) throw new ApiError(404, "Role not found");
  if (!role.builtin && (b.name !== undefined || b.description !== undefined)) {
    await db.updateTable("roles").set({ name: str(b.name, "name", { max: 50 }), description: str(b.description, "description", { optional: true, max: 200 }) }).where("id", "=", id).execute();
  }
  if (Array.isArray(b.permissions)) {
    const perms = [...new Set(b.permissions.filter((p): p is string => typeof p === "string" && isPermission(p)))];
    await db.transaction().execute(async (tx) => {
      await tx.deleteFrom("role_permissions").where("role_id", "=", id).execute();
      if (perms.length) await tx.insertInto("role_permissions").values(perms.map((p) => ({ role_id: id, permission: p }))).execute();
    });
    await audit(db, user, "role.permissions_changed", role.name, perms.join(", "));
  }
  return { ok: true };
});

export const DELETE = route<Ctx>(async (_req, { params }) => {
  const user = await requireUser("roles.manage");
  const { id } = await params;
  const db = await getDb();
  const role = await db.selectFrom("roles").selectAll().where("id", "=", id).executeTakeFirst();
  if (!role) throw new ApiError(404, "Role not found");
  if (role.builtin) throw new ApiError(400, "Built-in roles can't be deleted");
  if (await db.selectFrom("users").select("id").where("role_id", "=", id).executeTakeFirst()) throw new ApiError(400, "Move this role's members to another role first");
  await db.deleteFrom("roles").where("id", "=", id).execute();
  await audit(db, user, "role.deleted", role.name);
  return { ok: true };
});
