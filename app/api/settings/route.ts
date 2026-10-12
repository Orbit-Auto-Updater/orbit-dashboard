import { bool, int, oneOf, readJson, route, str } from "@/lib/server/api";
import { requireUser } from "@/lib/server/auth";
import { envDatabase, getDbConfig } from "@/lib/server/config";
import { getDb, sql } from "@/lib/server/db";
import { audit, getSettings, setSetting } from "@/lib/server/settings";
import { describeDb } from "@/lib/server/setup";

export const GET = route(async () => {
  await requireUser("org.settings");
  const db = await getDb();
  const s = await getSettings(db);
  const cfg = getDbConfig()!;
  const version = cfg.engine === "sqlite" ? await sql<{ v: string }>`select 'SQLite ' || sqlite_version() as v`.execute(db) : await sql<{ v: string }>`select version() as v`.execute(db);
  const count = async (t: "servers" | "metrics" | "logs" | "users") => Number((await db.selectFrom(t).select((eb) => eb.fn.countAll<number>().as("n")).executeTakeFirst())?.n ?? 0);
  return {
    orgName: s.org_name,
    publicUrl: s.public_url,
    metricsRetentionDays: Number(s.metrics_retention_days),
    logsRetentionDays: Number(s.logs_retention_days),
    cveScanEnabled: s.cve_scan_enabled === "1",
    cveScanIntervalHours: Number(s.cve_scan_interval_hours),
    webhookUrl: s.webhook_url,
    webhookMinSeverity: s.webhook_min_severity,
    database: {
      engine: cfg.engine, target: describeDb(cfg), fromEnv: envDatabase() !== null, version: version.rows[0]?.v ?? "",
      rows: { servers: await count("servers"), metrics: await count("metrics"), logs: await count("logs"), users: await count("users") },
    },
  };
});

export const PUT = route(async (req) => {
  const user = await requireUser("org.settings");
  const b = await readJson(req);
  const db = await getDb();
  const webhook = str(b.webhookUrl, "webhookUrl", { optional: true, max: 500, pattern: /^https:\/\/\S+$/ });
  const values: [Parameters<typeof setSetting>[1], string][] = [
    ["org_name", str(b.orgName, "orgName", { max: 100 })],
    ["public_url", str(b.publicUrl, "publicUrl", { optional: true, max: 300, pattern: /^https?:\/\/[^\s/]+(\/\S*)?$/ }).replace(/\/+$/, "")],
    ["metrics_retention_days", String(int(b.metricsRetentionDays, "metricsRetentionDays", 1, 365))],
    ["logs_retention_days", String(int(b.logsRetentionDays, "logsRetentionDays", 1, 365))],
    ["cve_scan_enabled", bool(b.cveScanEnabled, "cveScanEnabled") ? "1" : "0"],
    ["cve_scan_interval_hours", String(int(b.cveScanIntervalHours, "cveScanIntervalHours", 1, 168))],
    ["webhook_url", webhook],
    ["webhook_min_severity", oneOf(b.webhookMinSeverity, "webhookMinSeverity", ["critical", "warning", "info"] as const)],
  ];
  for (const [k, v] of values) await setSetting(db, k, v);
  await audit(db, user, "settings.updated", "organisation");
  return { ok: true };
});
