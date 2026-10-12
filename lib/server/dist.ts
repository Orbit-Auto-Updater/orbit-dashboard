/** Agent release files served to servers: install.sh and the binaries. */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { dataDir } from "./config";

/** Where `make release` output from linux-dash-agent should be copied. */
export function agentDistDirs() {
  return [process.env.AGENT_DIST_DIR, path.join(dataDir(), "agent"), path.resolve(process.cwd(), "../linux-dash-agent/dist")].filter(Boolean) as string[];
}

export const AGENT_ARCHES = ["amd64", "arm64", "arm", "386"] as const;
export type AgentArch = (typeof AGENT_ARCHES)[number];
const binaryName = (arch: string) => `linux-dash-agent-linux-${arch}`;

/** The first distribution directory that actually contains agent binaries. */
function releaseDir(): string | null {
  for (const dir of agentDistDirs()) {
    if (AGENT_ARCHES.some((a) => fs.existsSync(/*turbopackIgnore: true*/ path.join(dir, binaryName(a))))) return dir;
  }
  return null;
}

const hashCache = new Map<string, { key: string; sha256: string }>();

function sha256File(p: string, st: fs.Stats) {
  const key = `${st.size}:${st.mtimeMs}`;
  const hit = hashCache.get(p);
  if (hit?.key === key) return hit.sha256;
  const sha256 = crypto.createHash("sha256").update(fs.readFileSync(/*turbopackIgnore: true*/ p)).digest("hex");
  hashCache.set(p, { key, sha256 });
  return sha256;
}

export type AgentRelease = {
  version: string | null; // from dist/VERSION (written by `make release` and the Docker build)
  builtAt: number;
  dir: string;
  files: Partial<Record<AgentArch, { path: string; sha256: string; size: number }>>;
};

/** What this dashboard can hand out to agents: version and per-arch checksums. */
export function agentRelease(): AgentRelease | null {
  const dir = releaseDir();
  if (!dir) return null;
  const files: AgentRelease["files"] = {};
  let builtAt = 0;
  for (const arch of AGENT_ARCHES) {
    const p = path.join(dir, binaryName(arch));
    if (!fs.existsSync(/*turbopackIgnore: true*/ p)) continue;
    const st = fs.statSync(/*turbopackIgnore: true*/ p);
    builtAt = Math.max(builtAt, st.mtimeMs);
    files[arch] = { path: `/downloads/${binaryName(arch)}`, sha256: sha256File(p, st), size: st.size };
  }
  let version: string | null = null;
  try {
    version = fs.readFileSync(/*turbopackIgnore: true*/ path.join(dir, "VERSION"), "utf8").trim() || null;
  } catch {}
  return { version, builtAt: Math.round(builtAt), dir, files };
}

/** Compare release versions: -1 older, 0 same, 1 newer, null if not comparable. */
export function compareVersions(a: string, b: string): -1 | 0 | 1 | null {
  if (a === b) return 0;
  const parse = (v: string) => /^v?(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/.exec(v)?.slice(1, 4).map(Number);
  const x = parse(a);
  const y = parse(b);
  if (!x || !y) return null;
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] < y[i] ? -1 : 1;
  return 0;
}

export function findDistFile(name: string): string | null {
  const preferred = releaseDir();
  for (const dir of preferred ? [preferred, ...agentDistDirs()] : agentDistDirs()) {
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
