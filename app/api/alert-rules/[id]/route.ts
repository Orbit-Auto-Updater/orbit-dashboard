import { bool, int, notFound, oneOf, readJson, route } from "@/lib/server/api";
import { requireUser } from "@/lib/server/auth";
import { getDb } from "@/lib/server/db";
import { audit } from "@/lib/server/settings";

export const PUT = route<{ params: Promise<{ id: string }> }>(async (req, { params }) => {
  const user = await requireUser("servers.manage");
  const { id } = await params;
  const b = await readJson(req);
  const db = await getDb();
  const rule = await db.selectFrom("alert_rules").selectAll().where("id", "=", id).executeTakeFirst();
  if (!rule) throw notFound("Rule not found");
  const hasThreshold = ["cpu", "memory", "disk", "cve"].includes(rule.kind);
  const hasDuration = ["cpu", "memory", "offline"].includes(rule.kind);
  await db
    .updateTable("alert_rules")
    .set({
      enabled: bool(b.enabled, "enabled") ? 1 : 0,
      severity: oneOf(b.severity, "severity", ["critical", "warning", "info"] as const),
      threshold: hasThreshold ? int(b.threshold, "threshold", rule.kind === "cve" ? 1 : 1, rule.kind === "cve" ? 10 : 100) : rule.threshold,
      duration_minutes: hasDuration ? int(b.durationMinutes, "durationMinutes", rule.kind === "offline" ? 1 : 0, 1440) : rule.duration_minutes,
    })
    .where("id", "=", id)
    .execute();
  await audit(db, user, "alert_rule.updated", rule.name);
  return { ok: true };
});
