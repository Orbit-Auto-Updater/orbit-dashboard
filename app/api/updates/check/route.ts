import { readJson, route } from "@/lib/server/api";
import { requireUser } from "@/lib/server/auth";
import { bulkUpdates } from "@/lib/server/bulk";
import { getDb } from "@/lib/server/db";

export const POST = route(async (req) => {
  const user = await requireUser("updates.run");
  return bulkUpdates(await getDb(), user, await readJson(req), "check");
});
