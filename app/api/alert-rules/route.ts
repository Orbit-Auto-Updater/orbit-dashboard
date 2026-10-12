import { route } from "@/lib/server/api";
import { requireUser } from "@/lib/server/auth";
import { getDb } from "@/lib/server/db";

export const GET = route(async () => {
  await requireUser("logs.view");
  const db = await getDb();
  return { rules: await db.selectFrom("alert_rules").selectAll().orderBy("id").execute() };
});
