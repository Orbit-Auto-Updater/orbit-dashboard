import { notFound, route } from "@/lib/server/api";
import { requireUser } from "@/lib/server/auth";
import { getDb } from "@/lib/server/db";

export const GET = route<{ params: Promise<{ id: string }> }>(async (_req, { params }) => {
  await requireUser("metrics.view");
  const { id } = await params;
  const db = await getDb();
  const c = await db.selectFrom("commands").innerJoin("servers", "servers.id", "commands.server_id").selectAll("commands").select(["servers.hostname", "servers.display_name"]).where("commands.id", "=", id).executeTakeFirst();
  if (!c) throw notFound("Command not found");
  return { ...c, args: JSON.parse(c.args), server: c.display_name || c.hostname };
});
