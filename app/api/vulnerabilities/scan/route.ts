import { route } from "@/lib/server/api";
import { requireUser } from "@/lib/server/auth";
import { scanAll } from "@/lib/server/cve";
import { getDb } from "@/lib/server/db";
import { audit } from "@/lib/server/settings";

export const POST = route(async () => {
  const user = await requireUser("updates.run");
  const db = await getDb();
  await audit(db, user, "vulnerabilities.scan", "all servers");
  // Run in the background; the page polls for results.
  scanAll(db).catch((err) => console.warn("[cve] manual scan failed:", (err as Error).message));
  return { started: true };
});
