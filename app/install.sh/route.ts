import { connection } from "next/server";
import { isSetupComplete } from "@/lib/server/config";
import { getDb } from "@/lib/server/db";
import { installScript } from "@/lib/server/dist";
import { getSetting } from "@/lib/server/settings";

export async function GET(req: Request) {
  await connection();
  let publicUrl = new URL(req.url).origin;
  if (isSetupComplete()) publicUrl = (await getSetting(await getDb(), "public_url")) || publicUrl;
  const script = installScript(publicUrl);
  if (!script) return new Response("echo 'install.sh is not available on this dashboard yet (see AGENT_DIST_DIR)' >&2; exit 1\n", { status: 404, headers: { "Content-Type": "text/x-shellscript" } });
  return new Response(script, { headers: { "Content-Type": "text/x-shellscript; charset=utf-8", "Cache-Control": "no-store" } });
}
