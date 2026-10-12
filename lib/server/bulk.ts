import type { Kysely } from "kysely";
import { badRequest } from "./api";
import { queueCommand, validateCommand } from "./commands";
import { createUpdateJob } from "./jobs";
import type { DB } from "./schema";
import { audit } from "./settings";

const PKG = /^[A-Za-z0-9][A-Za-z0-9+._:@~-]{0,254}$/;

/** Start an update install (as a job) or an update check on many servers. */
export async function bulkUpdates(db: Kysely<DB>, user: { id: string; name: string }, b: Record<string, unknown>, mode: "check" | "apply") {
  const ids = b.serverIds === undefined || b.serverIds === "all" ? "all" : b.serverIds;
  if (ids !== "all" && (!Array.isArray(ids) || ids.some((x) => typeof x !== "string"))) throw badRequest("serverIds must be a list or \"all\"");
  const serverIds = ids as string[] | "all";

  if (mode === "apply") {
    const packages = b.packages === undefined ? [] : b.packages;
    if (!Array.isArray(packages) || packages.length > 2000 || packages.some((p) => typeof p !== "string" || !PKG.test(p))) throw badRequest("Invalid package list");
    return createUpdateJob(db, user, { serverIds, packages: packages as string[], securityOnly: b.securityOnly === true });
  }

  let q = db.selectFrom("servers").select("id");
  if (serverIds !== "all") q = q.where("id", "in", serverIds.length ? serverIds : ["-"]);
  const servers = await q.execute();
  const commands: { serverId: string; commandId: string }[] = [];
  const cmd = validateCommand("updates.check", {});
  for (const s of servers) commands.push({ serverId: s.id, commandId: await queueCommand(db, { serverId: s.id, type: cmd.type, args: cmd.args, label: cmd.label, user }) });
  await audit(db, user, "updates.check", `${commands.length} server(s)`);
  return { queued: commands.length, commands };
}
