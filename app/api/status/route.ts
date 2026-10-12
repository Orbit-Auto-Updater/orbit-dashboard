import { route } from "@/lib/server/api";
import { requireUser } from "@/lib/server/auth";
import { getDb } from "@/lib/server/db";
import { agentRelease, compareVersions } from "@/lib/server/dist";

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
  const running = await db.selectFrom("job_targets").select((eb) => eb.fn.count<number>("job_id").distinct().as("n")).where("status", "in", ["queued", "running"]).executeTakeFirst();
  const servers = await db.selectFrom("servers").select(["updates", "agent_version"]).execute();
  const shipped = agentRelease()?.version;
  const outdatedAgents = shipped ? servers.filter((s) => s.agent_version && s.agent_version !== shipped && compareVersions(s.agent_version, shipped) !== 1).length : 0;
  const pending = servers.reduce((a, s) => a + (s.updates ? (JSON.parse(s.updates).packages?.length ?? 0) : 0), 0);
  return { openAlerts: count(alerts), criticalAlerts: count(critical), seriousVulns: count(vulns), pendingUpdates: pending, runningJobs: count(running), outdatedAgents };
});
