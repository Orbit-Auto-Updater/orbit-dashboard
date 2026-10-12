import { route } from "@/lib/server/api";
import { requireUser } from "@/lib/server/auth";
import { getDb } from "@/lib/server/db";

export const GET = route(async () => {
  await requireUser("logs.view");
  const db = await getDb();
  return { entries: await db.selectFrom("audit_log").selectAll().orderBy("ts", "desc").limit(200).execute() };
});
