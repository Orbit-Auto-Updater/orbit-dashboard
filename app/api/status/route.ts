import { route } from "@/lib/server/api";
import { requireUser } from "@/lib/server/auth";
import { getDb } from "@/lib/server/db";

/** Small counters for the navigation badges. */
export const GET = route(async () => {
  await requireUser();
  const db = await getDb();
  const count = (n: { n: unknown } | undefined) => Number(n?.n ?? 0);
  const [alerts, critical, vulns] = await Promise.all([
    db.selectFrom("alerts").select((eb) => eb.fn.countAll().as("n")).where("status", "=", "open").executeTakeFirst(),
    db.selectFrom("alerts").select((eb) => eb.fn.countAll().as("n")).where("status", "=", "open").where("severity", "=", "critical").executeTakeFirst(),
    db.selectFrom("vulnerabilities").select((eb) => eb.fn.countAll().as("n")).where("status", "=", "open").where("severity", "in", ["critical", "high"]).executeTakeFirst(),
  ]);
  const servers = await db.selectFrom("servers").select("updates").execute();
  const pending = servers.reduce((a, s) => a + (s.updates ? (JSON.parse(s.updates).packages?.length ?? 0) : 0), 0);
  return { openAlerts: count(alerts), criticalAlerts: count(critical), seriousVulns: count(vulns), pendingUpdates: pending };
});
