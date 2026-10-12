import type { Kysely } from "kysely";
import { newId } from "./crypto";
import type { DB } from "./schema";

export type SettingKey =
  | "org_name"
  | "public_url"
  | "metrics_retention_days"
  | "logs_retention_days"
  | "cve_scan_enabled"
  | "cve_scan_interval_hours"
  | "cve_last_scan_at"
  | "cve_last_error"
  | "webhook_url"
  | "webhook_min_severity";

export async function getSettings(db: Kysely<DB>): Promise<Record<string, string>> {
  const rows = await db.selectFrom("settings").selectAll().execute();
  return Object.fromEntries(rows.map((r) => [r.key, r.value]));
}

export async function getSetting(db: Kysely<DB>, key: SettingKey, fallback = ""): Promise<string> {
  const row = await db.selectFrom("settings").select("value").where("key", "=", key).executeTakeFirst();
  return row?.value ?? fallback;
}

export async function setSetting(db: Kysely<DB>, key: SettingKey, value: string) {
  await db
    .insertInto("settings")
    .values({ key, value })
    .onConflict((oc) => oc.column("key").doUpdateSet({ value }))
    .execute();
}

export async function audit(
  db: Kysely<DB>,
  user: { id: string; name: string } | null,
  action: string,
  target: string,
  detail = "",
) {
  await db
    .insertInto("audit_log")
    .values({ id: newId("aud"), ts: Date.now(), user_id: user?.id ?? null, user_name: user?.name ?? "System", action, target, detail: detail.slice(0, 1000) })
    .execute();
}
