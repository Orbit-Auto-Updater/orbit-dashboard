import { readJson, route, str } from "@/lib/server/api";
import { requireUser } from "@/lib/server/auth";
import { clearSetupCode, writeConfig } from "@/lib/server/config";
import { getDb } from "@/lib/server/db";
import { createEnrollmentToken, installCommand } from "@/lib/server/enrollment";
import { audit, setSetting } from "@/lib/server/settings";
import { requireSetupAccess } from "@/lib/server/setup";

export const POST = route(async (req) => {
  requireSetupAccess(req);
  const user = await requireUser("org.settings");
  const b = await readJson(req);
  const orgName = str(b.orgName, "orgName", { max: 100 });
  const publicUrl = str(b.publicUrl, "publicUrl", { max: 300, pattern: /^https?:\/\/[^\s/]+(\/[^\s]*)?$/ }).replace(/\/+$/, "");
  const db = await getDb();
  await setSetting(db, "org_name", orgName);
  await setSetting(db, "public_url", publicUrl);
  const token = await createEnrollmentToken(db, { label: "Initial token", environment: "production", expiresInDays: 30, maxUses: null, user });
  writeConfig({ setupComplete: true });
  clearSetupCode();
  await audit(db, user, "setup.completed", orgName);
  return { token: token.token, installCommand: installCommand(publicUrl, token.token) };
});
