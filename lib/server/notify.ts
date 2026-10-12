/** Outbound notifications for new alerts (Slack-compatible JSON webhook). */
import type { Kysely } from "kysely";
import type { AlertsTable, DB } from "./schema";
import { getSettings } from "./settings";

const rank = { info: 0, warning: 1, critical: 2 } as const;

export async function notifyAlert(db: Kysely<DB>, alert: Pick<AlertsTable, "severity" | "title" | "detail" | "server_id" | "source">, hostname?: string) {
  const s = await getSettings(db);
  const url = s.webhook_url;
  if (!url) return;
  const min = (s.webhook_min_severity as keyof typeof rank) || "critical";
  if (rank[alert.severity] < (rank[min] ?? 2)) return;
  const icon = alert.severity === "critical" ? "🔴" : alert.severity === "warning" ? "🟠" : "🔵";
  const where = hostname ? ` on ${hostname}` : "";
  const text = `${icon} *${alert.title}*${where}\n${alert.detail}`;
  sendWebhook(url, { text, alert: { ...alert, hostname } }).catch((err) => console.warn("[notify] webhook failed:", (err as Error).message));
}

export async function sendWebhook(url: string, body: unknown) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) throw new Error(`webhook responded ${res.status}`);
}
