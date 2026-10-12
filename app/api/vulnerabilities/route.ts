import { badRequest, oneOf, readJson, route, str } from "@/lib/server/api";
import { requireUser } from "@/lib/server/auth";
import { updateCveAlert } from "@/lib/server/cve";
import { getDb } from "@/lib/server/db";
import { vulnerabilitiesList } from "@/lib/server/queries";
import { audit } from "@/lib/server/settings";

export const GET = route(async (req) => {
  await requireUser("metrics.view");
  return vulnerabilitiesList(await getDb(), new URL(req.url).searchParams.get("fixed") === "1");
});

/** Ignore (accept the risk of) or re-open findings. */
export const PATCH = route(async (req) => {
  const user = await requireUser("alerts.ack");
  const b = await readJson(req);
  const ids = b.ids;
  if (!Array.isArray(ids) || !ids.length || ids.length > 1000 || ids.some((x) => typeof x !== "string")) throw badRequest("ids must be a non-empty list");
  const status = oneOf(b.status, "status", ["ignored", "open"] as const);
  const reason = str(b.reason, "reason", { optional: true, max: 300 });
  const db = await getDb();
  const rows = await db.selectFrom("vulnerabilities").innerJoin("servers", "servers.id", "vulnerabilities.server_id").select(["vulnerabilities.id", "vulnerabilities.server_id", "vulnerabilities.vuln_id", "servers.hostname"]).where("vulnerabilities.id", "in", ids as string[]).where("vulnerabilities.status", "!=", "fixed").execute();
  if (rows.length) {
    await db
      .updateTable("vulnerabilities")
      .set(status === "ignored" ? { status, ignored_by: user.id, ignored_reason: reason || null } : { status, ignored_by: null, ignored_reason: null })
      .where("id", "in", rows.map((r) => r.id))
      .execute();
    for (const sid of new Set(rows.map((r) => r.server_id))) await updateCveAlert(db, sid, rows.find((r) => r.server_id === sid)!.hostname);
    await audit(db, user, status === "ignored" ? "vulnerability.ignored" : "vulnerability.reopened", [...new Set(rows.map((r) => r.vuln_id))].join(", "), reason);
  }
  return { updated: rows.length };
});
