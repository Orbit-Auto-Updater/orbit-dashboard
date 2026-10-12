import { ApiError, readJson, route, str } from "@/lib/server/api";
import { createSession } from "@/lib/server/auth";
import { hashPassword, sha256 } from "@/lib/server/crypto";
import { getDb } from "@/lib/server/db";
import { audit, getSetting } from "@/lib/server/settings";

type Ctx = { params: Promise<{ token: string }> };

async function findInvite(token: string) {
  const db = await getDb();
  const u = await db.selectFrom("users").select(["id", "name", "email", "invite_expires_at"]).where("invite_token_hash", "=", sha256(token)).where("status", "=", "invited").executeTakeFirst();
  if (!u || !u.invite_expires_at || u.invite_expires_at < Date.now()) throw new ApiError(404, "This invite link is invalid or has expired. Ask an admin for a new one.");
  return { db, u };
}

export const GET = route<Ctx>(async (_req, { params }) => {
  const { db, u } = await findInvite((await params).token);
  return { name: u.name, email: u.email, orgName: await getSetting(db, "org_name") };
});

export const POST = route<Ctx>(async (req, { params }) => {
  const { db, u } = await findInvite((await params).token);
  const password = str((await readJson(req)).password, "password", { min: 10, max: 500 });
  await db.updateTable("users").set({ password_hash: await hashPassword(password), status: "active", invite_token_hash: null, invite_expires_at: null }).where("id", "=", u.id).execute();
  await createSession(db, u.id, req);
  await audit(db, { id: u.id, name: u.name }, "user.joined", u.email);
  return { ok: true };
});
