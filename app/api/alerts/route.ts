import { route } from "@/lib/server/api";
import { requireUser } from "@/lib/server/auth";
import { getDb } from "@/lib/server/db";
import { alertsList } from "@/lib/server/queries";

export const GET = route(async (req) => {
  await requireUser("logs.view");
  return alertsList(await getDb(), new URL(req.url).searchParams.get("resolved") === "1");
});
