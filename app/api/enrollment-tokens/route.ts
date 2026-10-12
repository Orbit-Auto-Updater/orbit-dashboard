import { int, oneOf, readJson, route, str } from "@/lib/server/api";
import { requireUser } from "@/lib/server/auth";
import { getDb } from "@/lib/server/db";
import { createEnrollmentToken, installCommand } from "@/lib/server/enrollment";
import { getSetting } from "@/lib/server/settings";

export const GET = route(async (req) => {
  await requireUser("servers.manage");
  const db = await getDb();
  const tokens = await db.selectFrom("enrollment_tokens").select(["id", "label", "token_prefix", "environment", "created_at", "expires_at", "max_uses", "uses", "revoked", "last_used_at"]).orderBy("created_at", "desc").execute();
  const publicUrl = (await getSetting(db, "public_url")) || new URL(req.url).origin;
  return { tokens: tokens.map((t) => ({ ...t, revoked: t.revoked === 1, expired: !!t.expires_at && t.expires_at < Date.now() })), publicUrl };
});

export const POST = route(async (req) => {
  const user = await requireUser("servers.manage");
  const b = await readJson(req);
  const db = await getDb();
  const t = await createEnrollmentToken(db, {
    label: str(b.label, "label", { max: 80 }),
    environment: oneOf(b.environment, "environment", ["production", "staging", "development"] as const),
    expiresInDays: b.expiresInDays ? int(b.expiresInDays, "expiresInDays", 1, 365) : null,
    maxUses: b.maxUses ? int(b.maxUses, "maxUses", 1, 10000) : null,
    user,
  });
  const publicUrl = (await getSetting(db, "public_url")) || new URL(req.url).origin;
  return { ...t, installCommand: installCommand(publicUrl, t.token) };
});
