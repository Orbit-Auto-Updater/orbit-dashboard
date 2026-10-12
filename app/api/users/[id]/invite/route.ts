import { ApiError, route } from "@/lib/server/api";
import { requireUser } from "@/lib/server/auth";
import { getDb } from "@/lib/server/db";
import { newInvite } from "@/lib/server/users";

export const POST = route<{ params: Promise<{ id: string }> }>(async (req, { params }) => {
  await requireUser("users.manage");
  const { id } = await params;
  const db = await getDb();
  const u = await db.selectFrom("users").select("status").where("id", "=", id).executeTakeFirst();
  if (!u) throw new ApiError(404, "User not found");
  if (u.status !== "invited") throw new ApiError(400, "This user has already accepted their invite");
  return { inviteUrl: await newInvite(db, id, req) };
});
