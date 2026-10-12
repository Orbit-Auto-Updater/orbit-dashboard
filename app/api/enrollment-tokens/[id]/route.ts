import { route } from "@/lib/server/api";
import { requireUser } from "@/lib/server/auth";
import { getDb } from "@/lib/server/db";
import { audit } from "@/lib/server/settings";

export const DELETE = route<{ params: Promise<{ id: string }> }>(async (_req, { params }) => {
  const user = await requireUser("servers.manage");
  const { id } = await params;
  const db = await getDb();
  await db.updateTable("enrollment_tokens").set({ revoked: 1 }).where("id", "=", id).execute();
  await audit(db, user, "enrollment_token.revoked", id);
  return { ok: true };
});
