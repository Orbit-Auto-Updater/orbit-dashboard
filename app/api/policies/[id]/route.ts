import { badRequest, bool, int, notFound, oneOf, readJson, route, strList } from "@/lib/server/api";
import { requireUser } from "@/lib/server/auth";
import { getDb } from "@/lib/server/db";
import { audit } from "@/lib/server/settings";

export const PUT = route<{ params: Promise<{ id: string }> }>(async (req, { params }) => {
  const user = await requireUser("updates.policy");
  const { id } = await params;
  const b = await readJson(req);
  const db = await getDb();
  const p = await db.selectFrom("update_policies").select("name").where("id", "=", id).executeTakeFirst();
  if (!p) throw notFound("Policy not found");

  const mode = oneOf(b.mode, "mode", ["window", "interval"] as const);
  const days = strList(b.days, "days", /^(sun|mon|tue|wed|thu|fri|sat)$/, 7);
  const start = mode === "window" ? String(b.start ?? "") : "";
  if (mode === "window" && !/^([01]\d|2[0-3]):[0-5]\d$/.test(start)) throw badRequest("Start time must be HH:MM", { start: "HH:MM" });
  const timezone = typeof b.timezone === "string" && b.timezone ? b.timezone : "UTC";
  try {
    new Intl.DateTimeFormat("en", { timeZone: timezone });
  } catch {
    throw badRequest("Unknown timezone", { timezone: "Unknown timezone" });
  }
  await db
    .updateTable("update_policies")
    .set({
      enabled: bool(b.enabled, "enabled") ? 1 : 0,
      scope: oneOf(b.scope, "scope", ["security", "all"] as const),
      days: JSON.stringify(days),
      start,
      duration_minutes: mode === "window" ? int(b.durationMinutes ?? 120, "durationMinutes", 15, 1440) : 120,
      timezone,
      interval_hours: mode === "interval" ? int(b.intervalHours, "intervalHours", 1, 168) : 0,
      auto_reboot: bool(b.autoReboot ?? false, "autoReboot") ? 1 : 0,
      exclude: JSON.stringify(strList(b.exclude, "exclude", /^[A-Za-z0-9][A-Za-z0-9+._:@~-]{0,254}$/, 200)),
      updated_at: Date.now(),
    })
    .where("id", "=", id)
    .execute();
  await audit(db, user, "policy.updated", p.name);
  return { ok: true };
});
