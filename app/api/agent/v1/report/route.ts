import { authenticateAgent, ingestReport, readAgentBody } from "@/lib/server/agent";
import { route } from "@/lib/server/api";
import { scheduleScan } from "@/lib/server/cve";
import { getDb } from "@/lib/server/db";
import { getSetting } from "@/lib/server/settings";

export const POST = route(async (req) => {
  const db = await getDb();
  const server = await authenticateAgent(db, req);
  const { response, packagesChanged } = await ingestReport(db, server, await readAgentBody(req));
  if (packagesChanged && (await getSetting(db, "cve_scan_enabled", "1")) === "1") scheduleScan(db, server.id);
  return response;
});
