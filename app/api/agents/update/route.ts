import { badRequest, readJson, route } from "@/lib/server/api";
import { requireUser } from "@/lib/server/auth";
import { getDb } from "@/lib/server/db";
import { createAgentUpdateJob } from "@/lib/server/jobs";

/** Update agents to the version this dashboard ships: { serverIds: [...] | "outdated" } */
export const POST = route(async (req) => {
  const user = await requireUser("servers.manage");
  const b = await readJson(req);
  const ids = b.serverIds;
  if (ids !== "outdated" && (!Array.isArray(ids) || ids.some((x) => typeof x !== "string"))) throw badRequest('serverIds must be a list or "outdated"');
  return createAgentUpdateJob(await getDb(), user, ids as string[] | "outdated");
});
