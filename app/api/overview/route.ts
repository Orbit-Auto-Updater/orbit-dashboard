import { route } from "@/lib/server/api";
import { requireUser } from "@/lib/server/auth";
import { getDb } from "@/lib/server/db";
import { RANGES, overview, type Range } from "@/lib/server/queries";

export const GET = route(async (req) => {
  await requireUser("metrics.view");
  const r = new URL(req.url).searchParams.get("range") ?? "live";
  return overview(await getDb(), (r in RANGES ? r : "live") as Range);
});
