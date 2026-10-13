import fs from "node:fs";
import { Readable } from "node:stream";
import { findDistFile } from "@/lib/server/dist";

export async function GET(_req: Request, { params }: { params: Promise<{ file: string }> }) {
  const { file } = await params;
  if (!/^orbit-agent-linux-(amd64|arm64|arm|386)$|^SHA256SUMS$/.test(file)) return new Response("Not found\n", { status: 404 });
  const p = findDistFile(file);
  if (!p) return new Response(`${file} is not available. Build the agent with \`make release\` and copy dist/ to the dashboard's AGENT_DIST_DIR.\n`, { status: 404 });
  const stat = fs.statSync(p);
  return new Response(Readable.toWeb(fs.createReadStream(p)) as ReadableStream, {
    headers: { "Content-Type": "application/octet-stream", "Content-Length": String(stat.size), "Content-Disposition": `attachment; filename="${file}"` },
  });
}
