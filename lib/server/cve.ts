/**
 * Vulnerability scanning against OSV.dev (https://osv.dev), a free database
 * that aggregates distro security trackers (Debian, Ubuntu, Alpine, Rocky,
 * AlmaLinux). Packages with pending upgrades are checked at their installed
 * version; packages the distro flags as security updates are always listed,
 * so hosts OSV doesn't cover (RHEL, Fedora, Arch) still get alerts.
 */
import type { Kysely } from "kysely";
import type { Package, UpdateStatus } from "./agent-protocol";
import { raise, resolve, loadRules } from "./alerts";
import { newId } from "./crypto";
import type { DB, VulnSeverity } from "./schema";
import { setSetting } from "./settings";

const OSV = "https://api.osv.dev/v1";
const CACHE_MS = 24 * 3_600_000;

type Fetch = typeof fetch;

// ------------------------------------------------------------- ecosystems

/** OSV ecosystem for a host, from /etc/os-release ID and VERSION_ID. */
export function osvEcosystem(osId: string, osVersion: string): string | null {
  const id = osId.toLowerCase();
  const major = osVersion.split(".")[0];
  switch (id) {
    case "debian":
      return major ? `Debian:${major}` : null;
    case "ubuntu": {
      const m = /^(\d{2})\.(\d{2})/.exec(osVersion);
      if (!m) return null;
      const lts = m[2] === "04" && Number(m[1]) % 2 === 0;
      return `Ubuntu:${m[1]}.${m[2]}${lts ? ":LTS" : ""}`;
    }
    case "alpine": {
      const m = /^(\d+)\.(\d+)/.exec(osVersion);
      return m ? `Alpine:v${m[1]}.${m[2]}` : null;
    }
    case "rocky":
      return major ? `Rocky Linux:${major}` : null;
    case "almalinux":
      return major ? `AlmaLinux:${major}` : null;
  }
  return null;
}

// ------------------------------------------------------------------ CVSS

const W = {
  AV: { N: 0.85, A: 0.62, L: 0.55, P: 0.2 },
  AC: { L: 0.77, H: 0.44 },
  UI: { N: 0.85, R: 0.62 },
  C: { H: 0.56, L: 0.22, N: 0 },
} as const;

const roundUp = (x: number) => {
  const i = Math.round(x * 100000);
  return i % 10000 === 0 ? i / 100000 : (Math.floor(i / 10000) + 1) / 10;
};

/** CVSS v3.x base score from a vector string, or null if unparsable. */
export function cvss3Score(vector: string): number | null {
  if (!/^CVSS:3\.[01]\//.test(vector)) return null;
  const m: Record<string, string> = {};
  for (const part of vector.split("/").slice(1)) {
    const [k, v] = part.split(":");
    if (k && v) m[k] = v;
  }
  const av = W.AV[m.AV as keyof typeof W.AV];
  const ac = W.AC[m.AC as keyof typeof W.AC];
  const ui = W.UI[m.UI as keyof typeof W.UI];
  const c = W.C[m.C as keyof typeof W.C];
  const i = W.C[m.I as keyof typeof W.C];
  const a = W.C[m.A as keyof typeof W.C];
  const scope = m.S;
  if ([av, ac, ui, c, i, a].some((x) => x === undefined) || (scope !== "U" && scope !== "C") || !["N", "L", "H"].includes(m.PR)) return null;
  const pr = m.PR === "N" ? 0.85 : m.PR === "L" ? (scope === "C" ? 0.68 : 0.62) : scope === "C" ? 0.5 : 0.27;
  const iss = 1 - (1 - c) * (1 - i) * (1 - a);
  const impact = scope === "U" ? 6.42 * iss : 7.52 * (iss - 0.029) - 3.25 * (iss - 0.02) ** 15;
  if (impact <= 0) return 0;
  const exploitability = 8.22 * av * ac * pr * ui;
  return scope === "U" ? roundUp(Math.min(impact + exploitability, 10)) : roundUp(Math.min(1.08 * (impact + exploitability), 10));
}

export function severityFromScore(score: number): VulnSeverity {
  if (score >= 9) return "critical";
  if (score >= 7) return "high";
  if (score >= 4) return "medium";
  if (score > 0) return "low";
  return "unknown";
}

const WORDS: Record<string, VulnSeverity> = {
  critical: "critical", important: "high", high: "high", moderate: "medium", medium: "medium", low: "low", negligible: "low", unimportant: "low",
};

type OsvVuln = {
  id: string;
  summary?: string;
  details?: string;
  aliases?: string[];
  upstream?: string[];
  published?: string;
  severity?: { type: string; score: string }[];
  database_specific?: { severity?: string };
  affected?: {
    package?: { name?: string; ecosystem?: string };
    ranges?: { type: string; events: { introduced?: string; fixed?: string }[] }[];
    ecosystem_specific?: { urgency?: string; severity?: string };
    database_specific?: { severity?: string };
  }[];
};

export function osvSeverity(v: OsvVuln, pkg: string): { severity: VulnSeverity; score: number | null } {
  for (const s of v.severity ?? []) {
    if (s.type === "CVSS_V3") {
      const score = cvss3Score(s.score);
      if (score !== null) return { severity: severityFromScore(score), score };
    }
  }
  const affected = (v.affected ?? []).find((a) => a.package?.name === pkg) ?? v.affected?.[0];
  const word = [
    ...(v.severity ?? []).filter((s) => !s.type.startsWith("CVSS")).map((s) => s.score),
    affected?.ecosystem_specific?.severity, affected?.ecosystem_specific?.urgency, affected?.database_specific?.severity, v.database_specific?.severity,
  ]
    .map((w) => w?.toLowerCase().replace(/\*$/, ""))
    .find((w) => w && WORDS[w]);
  return { severity: word ? WORDS[word] : "unknown", score: null };
}

/** Fixed version for this exact distro release (records cover many releases). */
export function osvFixedVersion(v: OsvVuln, pkg: string, ecosystem: string): string | null {
  for (const a of v.affected ?? []) {
    if (a.package?.name !== pkg || a.package?.ecosystem !== ecosystem) continue;
    for (const r of a.ranges ?? []) for (const e of r.events) if (e.fixed) return e.fixed;
  }
  return null;
}

/** The CVE id when there is one (from aliases, upstream, or a DISTRO-CVE-… id). */
export function primaryId(v: { id: string; aliases?: string[]; upstream?: string[] }) {
  if (v.id.startsWith("CVE-")) return v.id;
  const linked = [...(v.aliases ?? []), ...(v.upstream ?? [])].find((a) => a.startsWith("CVE-"));
  if (linked) return linked;
  return /(CVE-\d{4}-\d{4,})/.exec(v.id)?.[1] ?? v.id;
}

/** Run fn over items with limited concurrency. */
async function pool<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = await fn(items[i]);
      }
    }),
  );
  return out;
}

// --------------------------------------------------------------- scanning

async function osvDetails(db: Kysely<DB>, id: string, f: Fetch): Promise<OsvVuln | null> {
  const cached = await db.selectFrom("osv_cache").selectAll().where("id", "=", id).executeTakeFirst();
  if (cached && Date.now() - cached.fetched_at < CACHE_MS) return JSON.parse(cached.data) as OsvVuln;
  const res = await f(`${OSV}/vulns/${encodeURIComponent(id)}`, { signal: AbortSignal.timeout(20_000) });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`OSV ${res.status} for ${id}`);
  const data = (await res.json()) as OsvVuln;
  await db
    .insertInto("osv_cache")
    .values({ id, data: JSON.stringify(data), fetched_at: Date.now() })
    .onConflict((oc) => oc.column("id").doUpdateSet({ data: JSON.stringify(data), fetched_at: Date.now() }))
    .execute();
  return data;
}

type Found = { pkg: string; binaries: Set<string>; installed: string; fixed: string | null; vulnId: string; aliases: string[]; severity: VulnSeverity; score: number | null; summary: string; url: string; origin: "osv" | "package-manager" };

export async function scanServer(db: Kysely<DB>, serverId: string, f: Fetch = fetch) {
  const server = await db.selectFrom("servers").select(["id", "hostname", "os_id", "os_version", "updates"]).where("id", "=", serverId).executeTakeFirst();
  if (!server) return;
  const status = server.updates ? (JSON.parse(server.updates) as UpdateStatus) : null;
  const pkgs: Package[] = (status?.packages ?? []).filter((p) => p.current);
  const ecosystem = osvEcosystem(server.os_id, server.os_version);
  const found = new Map<string, Found>();
  const now = Date.now();

  try {
    if (ecosystem && pkgs.length) {
      // One query per (source package, installed version).
      const bySource = new Map<string, { name: string; version: string; binaries: Set<string> }>();
      for (const p of pkgs) {
        const name = p.source || p.name;
        const key = `${name}@${p.current}`;
        if (!bySource.has(key)) bySource.set(key, { name, version: p.current!, binaries: new Set() });
        bySource.get(key)!.binaries.add(p.name);
      }
      const queries = [...bySource.values()];
      for (let i = 0; i < queries.length; i += 500) {
        const chunk = queries.slice(i, i + 500);
        const res = await f(`${OSV}/querybatch`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ queries: chunk.map((q) => ({ package: { name: q.name, ecosystem }, version: q.version })) }),
          signal: AbortSignal.timeout(30_000),
        });
        if (!res.ok) throw new Error(`OSV querybatch responded ${res.status}`);
        const body = (await res.json()) as { results: { vulns?: { id: string }[] }[] };
        for (const [j, r] of (body.results ?? []).entries()) {
          const q = chunk[j];
          const details = await pool(r.vulns ?? [], 8, ({ id }) => osvDetails(db, id, f));
          for (const v of details) {
            if (!v) continue;
            const sev = osvSeverity(v, q.name);
            const vulnId = primaryId(v);
            found.set(`${q.name}|${vulnId}`, {
              pkg: q.name, binaries: q.binaries, installed: q.version, fixed: osvFixedVersion(v, q.name, ecosystem), vulnId,
              aliases: [v.id, ...(v.aliases ?? [])].filter((a) => a !== vulnId), ...sev,
              summary: (v.summary || v.details || "").split("\n")[0].slice(0, 300), url: `https://osv.dev/vulnerability/${encodeURIComponent(v.id)}`, origin: "osv",
            });
          }
        }
      }
    }

    // Distro-flagged security updates that OSV didn't already explain.
    for (const p of pkgs.filter((x) => x.security)) {
      const name = p.source || p.name;
      if ([...found.values()].some((v) => v.pkg === name)) continue;
      const vulnId = p.advisory || `security-update:${name}`;
      found.set(`${name}|${vulnId}`, {
        pkg: name, binaries: new Set([p.name]), installed: p.current!, fixed: p.available, vulnId, aliases: [], severity: "unknown", score: null,
        summary: p.advisory ? `Security advisory ${p.advisory} from the distribution` : "Security update published by the distribution", url: "", origin: "package-manager",
      });
    }
  } catch (err) {
    await db.updateTable("servers").set({ cve_error: (err as Error).message, cve_scanned_at: now }).where("id", "=", serverId).execute();
    throw err;
  }

  // Upsert findings; anything no longer found is fixed.
  for (const v of found.values()) {
    const values = {
      binaries: [...v.binaries].sort().join(", "), installed_version: v.installed, fixed_version: v.fixed, aliases: JSON.stringify(v.aliases),
      severity: v.severity, score: v.score, summary: v.summary, url: v.url, origin: v.origin, last_seen: now,
    };
    const existing = await db.selectFrom("vulnerabilities").select(["id", "status"]).where("server_id", "=", serverId).where("package", "=", v.pkg).where("vuln_id", "=", v.vulnId).executeTakeFirst();
    if (existing) {
      await db.updateTable("vulnerabilities").set({ ...values, status: existing.status === "ignored" ? "ignored" : "open" }).where("id", "=", existing.id).execute();
    } else {
      await db.insertInto("vulnerabilities").values({ id: newId("vul"), server_id: serverId, package: v.pkg, vuln_id: v.vulnId, status: "open", first_seen: now, ignored_by: null, ignored_reason: null, ...values }).execute();
    }
  }
  await db.updateTable("vulnerabilities").set({ status: "fixed" }).where("server_id", "=", serverId).where("status", "=", "open").where("last_seen", "<", now).execute();
  await db.updateTable("servers").set({ cve_scanned_at: now, cve_error: ecosystem || !pkgs.length ? null : "OSV has no data for this distribution; showing distro security updates only" }).where("id", "=", serverId).execute();

  await updateCveAlert(db, serverId, server.hostname);
  return { ecosystem, checked: pkgs.length, findings: found.size };
}

export async function updateCveAlert(db: Kysely<DB>, serverId: string, hostname: string) {
  const rule = (await loadRules(db)).cve;
  const fp = `cve:${serverId}`;
  if (!rule?.enabled) return resolve(db, fp);
  const open = await db.selectFrom("vulnerabilities").select(["package", "vuln_id", "severity", "score"]).where("server_id", "=", serverId).where("status", "=", "open").execute();
  const serious = open.filter((v) => (v.score ?? (v.severity === "critical" ? 9 : v.severity === "high" ? 7 : 0)) >= rule.threshold);
  if (!serious.length) return resolve(db, fp);
  const critical = serious.some((v) => v.severity === "critical");
  const pkgs = [...new Set(serious.map((v) => v.package))];
  const list = pkgs.slice(0, 4).join(", ") + (pkgs.length > 4 ? ` +${pkgs.length - 4} more` : "");
  await raise(
    db,
    {
      fingerprint: fp, serverId, severity: critical ? "critical" : rule.severity === "critical" ? "warning" : rule.severity, source: "cve",
      title: `${serious.length} serious ${serious.length === 1 ? "vulnerability" : "vulnerabilities"}`, detail: `Fix available by updating: ${list}`,
    },
    hostname,
  );
}

let scanning: Promise<void> | null = null;

export async function scanAll(db: Kysely<DB>, f: Fetch = fetch) {
  if (scanning) return scanning;
  scanning = (async () => {
    const servers = await db.selectFrom("servers").select("id").execute();
    let lastError = "";
    for (const s of servers) {
      try {
        await scanServer(db, s.id, f);
      } catch (err) {
        lastError = (err as Error).message;
      }
    }
    await setSetting(db, "cve_last_scan_at", String(Date.now()));
    await setSetting(db, "cve_last_error", lastError);
  })().finally(() => {
    scanning = null;
  });
  return scanning;
}

const pendingScans = new Map<string, NodeJS.Timeout>();

/** Debounced scan after a server's package list changes. */
export function scheduleScan(db: Kysely<DB>, serverId: string, delayMs = 15_000) {
  clearTimeout(pendingScans.get(serverId));
  pendingScans.set(
    serverId,
    setTimeout(() => {
      pendingScans.delete(serverId);
      scanServer(db, serverId).catch((err) => console.warn(`[cve] scan of ${serverId} failed:`, (err as Error).message));
    }, delayMs),
  );
}
