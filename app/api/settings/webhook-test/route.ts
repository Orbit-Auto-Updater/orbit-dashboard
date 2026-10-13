import { ApiError, route } from "@/lib/server/api";
import { requireUser } from "@/lib/server/auth";
import { getDb } from "@/lib/server/db";
import { sendWebhook } from "@/lib/server/notify";
import { getSetting } from "@/lib/server/settings";

export const POST = route(async () => {
  const user = await requireUser("org.settings");
  const db = await getDb();
  const url = await getSetting(db, "webhook_url");
  if (!url) throw new ApiError(400, "Save a webhook URL first");
  try {
    await sendWebhook(url, { text: `✅ Test notification from Orbit (sent by ${user.name})` });
  } catch (err) {
    throw new ApiError(502, `Webhook failed: ${(err as Error).message}`);
  }
  return { ok: true };
});
