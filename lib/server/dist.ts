/** Agent release files served to servers: install.sh and the binaries. */
import fs from "node:fs";
import path from "node:path";
import { dataDir } from "./config";

/** Where `make release` output from linux-dash-agent should be copied. */
export function agentDistDirs() {
  return [process.env.AGENT_DIST_DIR, path.join(dataDir(), "agent"), path.resolve(process.cwd(), "../linux-dash-agent/dist")].filter(Boolean) as string[];
}

export function findDistFile(name: string): string | null {
  for (const dir of agentDistDirs()) {
    const p = path.join(dir, name);
    if (fs.existsSync(/*turbopackIgnore: true*/ p) && fs.statSync(/*turbopackIgnore: true*/ p).isFile()) return p;
  }
  return null;
}

export function installScript(publicUrl: string): string | null {
  const file = findDistFile("install.sh") ?? (fs.existsSync(/*turbopackIgnore: true*/ path.resolve(process.cwd(), "../linux-dash-agent/deploy/install.sh")) ? path.resolve(process.cwd(), "../linux-dash-agent/deploy/install.sh") : null);
  if (!file) return null;
  // Default the dashboard address to this dashboard, so `curl … | sudo sh` needs no flags.
  return fs.readFileSync(/*turbopackIgnore: true*/ file, "utf8").replace("SERVER=${LINUX_DASH_SERVER:-}", `SERVER=\${LINUX_DASH_SERVER:-${publicUrl.replace(/[^A-Za-z0-9:/._~\-[\]]/g, "")}}`);
}
