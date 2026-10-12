import { badRequest, notFound, route } from "@/lib/server/api";
import { requireUser } from "@/lib/server/auth";
import { getDb } from "@/lib/server/db";
import { jobLogs } from "@/lib/server/jobs";

/**
 * GET ?target=<id>&after=<seq>  → new lines since `after` (poll every second)
 * GET ?target=<id>&format=text  → the whole log as a download
 */
export const GET = route<{ params: Promise<{ id: string }> }>(async (req, { params }) => {
  await requireUser("logs.view");
  const { id } = await params;
  const q = new URL(req.url).searchParams;
  const target = q.get("target");
  if (!target) throw badRequest("target is required");
  const db = await getDb();
  if (q.get("format") === "text") {
    const all = await jobLogs(db, id, target, -1, 20_000);
    if (!all) throw notFound("Log not found");
    const t = await db.selectFrom("job_targets").innerJoin("servers", "servers.id", "job_targets.server_id").select(["servers.hostname"]).where("job_targets.id", "=", target).executeTakeFirst();
    const body = all.lines.map((l) => `${new Date(l.ts).toISOString()} ${l.stream.padEnd(6)} ${l.text}`).join("\n") + "\n";
    return new Response(body, { headers: { "Content-Type": "text/plain; charset=utf-8", "Content-Disposition": `attachment; filename="${id}-${t?.hostname ?? target}.log"`, "Cache-Control": "no-store" } });
  }
  const res = await jobLogs(db, id, target, Number(q.get("after") ?? -1));
  if (!res) throw notFound("Log not found");
  return res;
});
