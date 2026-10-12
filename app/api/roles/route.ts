import { ApiError, readJson, route, str } from "@/lib/server/api";
import { requireUser } from "@/lib/server/auth";
import { newId } from "@/lib/server/crypto";
import { getDb } from "@/lib/server/db";
import { audit } from "@/lib/server/settings";
import { isPermission } from "@/lib/permissions";

export const GET = route(async () => {
  await requireUser("users.manage");
  const db = await getDb();
  const [roles, perms, counts] = await Promise.all([
    db.selectFrom("roles").selectAll().execute(),
    db.selectFrom("role_permissions").selectAll().execute(),
    db.selectFrom("users").select((eb) => ["role_id", eb.fn.countAll<number>().as("n")]).groupBy("role_id").execute(),
  ]);
  const order = ["owner", "admin", "operator", "viewer"];
  return {
    roles: roles
      .sort((a, b) => (order.indexOf(a.id) + 1 || 99) - (order.indexOf(b.id) + 1 || 99) || a.name.localeCompare(b.name))
      .map((r) => ({ ...r, builtin: r.builtin === 1, members: Number(counts.find((c) => c.role_id === r.id)?.n ?? 0), permissions: perms.filter((p) => p.role_id === r.id).map((p) => p.permission) })),
  };
});

export const POST = route(async (req) => {
  const user = await requireUser("roles.manage");
  const b = await readJson(req);
  const name = str(b.name, "name", { max: 50 });
  const description = str(b.description, "description", { optional: true, max: 200 });
  const permissions = Array.isArray(b.permissions) ? b.permissions.filter((p): p is string => typeof p === "string" && isPermission(p)) : [];
  const db = await getDb();
  if (await db.selectFrom("roles").select("id").where("name", "=", name).executeTakeFirst()) throw new ApiError(409, "A role with that name exists", { name: "Already exists" });
  const id = newId("role", 6);
  await db.insertInto("roles").values({ id, name, description, builtin: 0 }).execute();
  if (permissions.length) await db.insertInto("role_permissions").values(permissions.map((p) => ({ role_id: id, permission: p }))).execute();
  await audit(db, user, "role.created", name);
  return { id };
});
