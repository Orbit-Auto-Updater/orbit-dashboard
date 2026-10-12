import { readJson, route } from "@/lib/server/api";
import { requireUser } from "@/lib/server/auth";
import { bulkUpdates } from "@/lib/server/bulk";
import { getDb } from "@/lib/server/db";
import { jobsList } from "@/lib/server/jobs";

export const GET = route(async (req) => {
  await requireUser("metrics.view");
  const limit = Math.min(Number(new URL(req.url).searchParams.get("limit")) || 50, 200);
  return { jobs: await jobsList(await getDb(), limit) };
});

/** Start an update install job: { serverIds: [...] | "all", packages?, securityOnly? } */
export const POST = route(async (req) => {
  const user = await requireUser("updates.run");
  return bulkUpdates(await getDb(), user, await readJson(req), "apply");
});
