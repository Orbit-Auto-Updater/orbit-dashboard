import { route } from "@/lib/server/api";
import { requireUser } from "@/lib/server/auth";
import { getDb } from "@/lib/server/db";
import { logsList } from "@/lib/server/queries";

export const GET = route(async (req) => {
  await requireUser("logs.view");
  const q = new URL(req.url).searchParams;
  const prio = q.get("priority");
  return { logs: await logsList(await getDb(), { serverId: q.get("server") || undefined, minPriority: prio ? Number(prio) : undefined, limit: Number(q.get("limit")) || 200 }) };
});
