import { authenticateAgent, readAgentBody } from "@/lib/server/agent";
import { route } from "@/lib/server/api";
import { getDb } from "@/lib/server/db";
import { ingestProgress } from "@/lib/server/jobs";

export const POST = route(async (req) => {
  const db = await getDb();
  const server = await authenticateAgent(db, req);
  await db.updateTable("servers").set({ last_seen_at: Date.now() }).where("id", "=", server.id).execute();
  await ingestProgress(db, server, await readAgentBody(req));
  return new Response(null, { status: 204 });
});
