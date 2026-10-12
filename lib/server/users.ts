import type { Kysely } from "kysely";
import { ApiError } from "./api";
import type { CurrentUser } from "./auth";
import { randomToken, sha256 } from "./crypto";
import type { DB } from "./schema";
import { getSetting } from "./settings";

export const INVITE_HOURS = 72;

export async function newInvite(db: Kysely<DB>, userId: string, req: Request) {
  const token = randomToken(24);
  await db.updateTable("users").set({ invite_token_hash: sha256(token), invite_expires_at: Date.now() + INVITE_HOURS * 3_600_000 }).where("id", "=", userId).execute();
  const base = (await getSetting(db, "public_url")) || new URL(req.url).origin;
  return `${base}/invite/${token}`;
}

/** Guard rails for changing another user's role or status. */
export async function assertCanManage(db: Kysely<DB>, actor: CurrentUser, targetId: string, change: { roleId?: string; status?: string; remove?: boolean }) {
  const target = await db.selectFrom("users").select(["id", "role_id", "status"]).where("id", "=", targetId).executeTakeFirst();
  if (!target) throw new ApiError(404, "User not found");
  if (target.id === actor.id && (change.roleId !== undefined || change.status !== undefined || change.remove)) {
    throw new ApiError(400, "You can't change your own role or status, or remove yourself");
  }
  const touchesOwner = target.role_id === "owner" || change.roleId === "owner";
  if (touchesOwner && actor.role !== "owner") throw new ApiError(403, "Only an owner can grant, change or remove the owner role");
  if (target.role_id === "owner" && (change.remove || (change.roleId && change.roleId !== "owner") || change.status === "suspended")) {
    const owners = await db.selectFrom("users").select("id").where("role_id", "=", "owner").where("status", "=", "active").execute();
    if (owners.filter((o) => o.id !== target.id).length === 0) throw new ApiError(400, "There must always be at least one active owner");
  }
  return target;
}
