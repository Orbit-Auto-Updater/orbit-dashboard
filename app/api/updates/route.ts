import { route } from "@/lib/server/api";
import { requireUser } from "@/lib/server/auth";
import { getDb } from "@/lib/server/db";
import { updatesOverview } from "@/lib/server/queries";

export const GET = route(async () => {
  await requireUser("metrics.view");
  return updatesOverview(await getDb());
});
