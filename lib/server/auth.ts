/**
 * Sessions and authorisation. Sessions are random tokens in an httpOnly
 * cookie; only their SHA-256 is stored. Every API route resolves the user
 * through requireUser(), which also enforces role permissions.
 */
import { cookies } from "next/headers";
import type { Kysely } from "kysely";
import { isPermission, type Permission } from "../permissions";
import { ApiError, clientIp } from "./api";
import { randomToken, sha256 } from "./crypto";
import { getDb } from "./db";
import type { DB } from "./schema";

export const SESSION_COOKIE = "orbit_session";
const SESSION_DAYS = 30;
const TOUCH_EVERY_MS = 5 * 60_000;

export type CurrentUser = {
  id: string;
  name: string;
  email: string;
  role: string;
  roleName: string;
  timezone: string | null;
  permissions: Permission[];
  sessionId: string;
};

export async function permissionsFor(db: Kysely<DB>, roleId: string): Promise<Permission[]> {
  const rows = await db.selectFrom("role_permissions").select("permission").where("role_id", "=", roleId).execute();
  return rows.map((r) => r.permission).filter(isPermission);
}

export async function createSession(db: Kysely<DB>, userId: string, req: Request) {
  const token = randomToken();
  const now = Date.now();
  await db
    .insertInto("sessions")
    .values({
      id: sha256(token), user_id: userId, created_at: now, expires_at: now + SESSION_DAYS * 86_400_000, last_seen_at: now,
      ip: clientIp(req), user_agent: (req.headers.get("user-agent") ?? "").slice(0, 300),
    })
    .execute();
  await db.updateTable("users").set({ last_active_at: now }).where("id", "=", userId).execute();
  const secure = new URL(req.url).protocol === "https:" || req.headers.get("x-forwarded-proto") === "https";
  (await cookies()).set(SESSION_COOKIE, token, {
    httpOnly: true, sameSite: "lax", secure, path: "/", maxAge: SESSION_DAYS * 86_400,
  });
}

export async function destroySession() {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (token) {
    const db = await getDb();
    await db.deleteFrom("sessions").where("id", "=", sha256(token)).execute();
  }
  jar.delete(SESSION_COOKIE);
}

export async function getCurrentUser(): Promise<CurrentUser | null> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return null;
  const db = await getDb();
  const id = sha256(token);
  const row = await db
    .selectFrom("sessions as s")
    .innerJoin("users as u", "u.id", "s.user_id")
    .innerJoin("roles as r", "r.id", "u.role_id")
    .select(["s.id as sid", "s.expires_at", "s.last_seen_at", "u.id", "u.name", "u.email", "u.role_id", "u.status", "u.timezone", "r.name as role_name"])
    .where("s.id", "=", id)
    .executeTakeFirst();
  const now = Date.now();
  if (!row || row.expires_at < now || row.status !== "active") return null;
  if (now - row.last_seen_at > TOUCH_EVERY_MS) {
    await db.updateTable("sessions").set({ last_seen_at: now }).where("id", "=", id).execute();
    await db.updateTable("users").set({ last_active_at: now }).where("id", "=", row.id).execute();
  }
  return {
    id: row.id, name: row.name, email: row.email, role: row.role_id, roleName: row.role_name, timezone: row.timezone,
    permissions: await permissionsFor(db, row.role_id), sessionId: row.sid,
  };
}

/** Resolve the signed-in user or throw 401; with a permission, throw 403 if missing. */
export async function requireUser(permission?: Permission): Promise<CurrentUser> {
  const user = await getCurrentUser();
  if (!user) throw new ApiError(401, "Not signed in");
  if (permission && !user.permissions.includes(permission)) {
    throw new ApiError(403, `Your role doesn't allow this (needs ${permission})`);
  }
  return user;
}

export function can(user: CurrentUser, permission: Permission) {
  return user.permissions.includes(permission);
}

// --------------------------------------------------------- login throttling

const attempts = new Map<string, { count: number; until: number }>();

/** Allow 10 failed logins per key per 15 minutes. */
export function loginThrottle(key: string) {
  const now = Date.now();
  const a = attempts.get(key);
  if (a && a.until > now && a.count >= 10) {
    throw new ApiError(429, "Too many failed sign-in attempts. Try again in a few minutes.");
  }
  return {
    fail() {
      const cur = attempts.get(key);
      if (!cur || cur.until < now) attempts.set(key, { count: 1, until: now + 15 * 60_000 });
      else cur.count++;
    },
    success() {
      attempts.delete(key);
    },
  };
}
