import { route } from "@/lib/server/api";
import { requireUser } from "@/lib/server/auth";
import { getDb } from "@/lib/server/db";

export const DELETE = route<{ params: Promise<{ id: string }> }>(async (_req, { params }) => {
  const user = await requireUser();
  const { id } = await params;
  const db = await getDb();
  await db.deleteFrom("sessions").where("user_id", "=", user.id).where("id", "=", id).execute();
  return { ok: true };
});
