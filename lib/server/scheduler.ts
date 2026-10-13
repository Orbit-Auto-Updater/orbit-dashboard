/**
 * Background housekeeping, started once per server process from
 * instrumentation.ts: offline detection, command expiry, data retention and
 * periodic vulnerability scans.
 */
import { checkOffline } from "./alerts";
import { isSetupComplete } from "./config";
import { scanAll } from "./cve";
import { getDb } from "./db";
import { expireTargets } from "./jobs";
import { getSettings } from "./settings";

const TICK_MS = 60_000;
const g = globalThis as unknown as { __orbitScheduler?: NodeJS.Timeout };
let lastPrune = 0;

export function startScheduler() {
  if (g.__orbitScheduler) return;
  g.__orbitScheduler = setInterval(() => {
    tick().catch((err) => console.warn("[scheduler]", (err as Error).message));
  }, TICK_MS);
  g.__orbitScheduler.unref?.();
}

export async function tick(now = Date.now()) {
  if (!isSetupComplete()) return;
  const db = await getDb();

  await checkOffline(db, now);
  await db.updateTable("commands").set({ status: "expired" }).where("status", "in", ["pending", "delivered"]).where("expires_at", "<", now).execute();
  await expireTargets(db, now);

  const s = await getSettings(db);
  if (now - lastPrune > 3_600_000) {
    lastPrune = now;
    const metricsDays = Number(s.metrics_retention_days) || 7;
    const logsDays = Number(s.logs_retention_days) || 30;
    await db.deleteFrom("metrics").where("ts", "<", now - metricsDays * 86_400_000).execute();
    await db.deleteFrom("logs").where("ts", "<", now - logsDays * 86_400_000).execute();
    await db.deleteFrom("sessions").where("expires_at", "<", now).execute();
    await db.deleteFrom("alerts").where("status", "=", "resolved").where("resolved_at", "<", now - 90 * 86_400_000).execute();
    await db.deleteFrom("commands").where("created_at", "<", now - 90 * 86_400_000).execute();
    await db.deleteFrom("jobs").where("created_at", "<", now - 90 * 86_400_000).execute(); // logs cascade
  }

  if (s.cve_scan_enabled === "1") {
    const every = (Number(s.cve_scan_interval_hours) || 12) * 3_600_000;
    if (now - (Number(s.cve_last_scan_at) || 0) > every) await scanAll(db);
  }
}
