import { route } from "@/lib/server/api";
import { destroySession } from "@/lib/server/auth";

export const POST = route(async () => {
  await destroySession();
  return { ok: true };
});
