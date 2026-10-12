import type { Kysely } from "kysely";
import type { UpdateStatus } from "./agent-protocol";
import { queueCommand } from "./agent";
import { badRequest } from "./api";
import { validateCommand } from "./commands";
import type { DB } from "./schema";
import { audit } from "./settings";

/** Queue an update check or install on many servers at once. */
export async function bulkUpdates(db: Kysely<DB>, user: { id: string; name: string }, b: Record<string, unknown>, mode: "check" | "apply") {
  const ids = b.serverIds === undefined || b.serverIds === "all" ? null : b.serverIds;
  if (ids !== null && (!Array.isArray(ids) || ids.some((x) => typeof x !== "string"))) throw badRequest("serverIds must be a list or \"all\"");
  let q = db.selectFrom("servers").select(["id", "hostname", "updates"]);
  if (ids) q = q.where("id", "in", ids.length ? (ids as string[]) : ["-"]);
  const servers = await q.execute();
  const packages = Array.isArray(b.packages) ? (b.packages as string[]) : [];
  const queued: { serverId: string; commandId: string }[] = [];
  for (const s of servers) {
    let args: Record<string, unknown> = {};
    if (mode === "apply") {
      const pending = ((s.updates ? (JSON.parse(s.updates) as UpdateStatus).packages : []) ?? []).map((p) => p.name);
      const wanted = packages.length ? packages.filter((p) => pending.includes(p)) : [];
      if (packages.length && !wanted.length) continue; // nothing to do on this host
      args = { packages: wanted.length ? wanted : undefined, security_only: b.securityOnly === true || undefined };
    }
    const cmd = validateCommand(mode === "apply" ? "updates.apply" : "updates.check", args);
    queued.push({ serverId: s.id, commandId: await queueCommand(db, { serverId: s.id, type: cmd.type, args: cmd.args, label: cmd.label, user }) });
  }
  await audit(db, user, `updates.${mode}`, `${queued.length} server(s)`, packages.length ? packages.slice(0, 20).join(", ") : b.securityOnly ? "security updates" : "all updates");
  return { queued: queued.length, commands: queued };
}
