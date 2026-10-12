/** Read models for the dashboard pages. */
import type { Kysely } from "kysely";
import type { Apps, Metrics, UpdateStatus } from "./agent-protocol";
import { osvEcosystem } from "./cve";
import type { DB, ServersTable } from "./schema";
import { getSettings } from "./settings";

export const OFFLINE_AFTER_MS = 90_000;

export type Health = "healthy" | "warning" | "critical" | "offline";

const parse = <T>(s: string | null): T | null => (s ? (JSON.parse(s) as T) : null);

export type Range = "live" | "1h" | "24h" | "7d";
export const RANGES: Record<Range, { span: number; points: number }> = {
  live: { span: 400_000, points: 40 }, // 10 s buckets
  "1h": { span: 3_600_000, points: 40 },
  "24h": { span: 86_400_000, points: 40 },
  "7d": { span: 7 * 86_400_000, points: 40 },
};

type Sample = { server_id: string; ts: number; cpu: number; mem_pct: number; rx_bps: number; tx_bps: number };
type SeriesKey = "cpu" | "mem" | "rx" | "tx";

/**
 * Bucket raw samples into N+1 points (the first sits just off-chart for the
 * scrolling animation). CPU/memory are averaged across servers, network is
 * summed. The current, still-filling bucket is excluded; gaps carry forward.
 */
export function bucketSeries(rows: Sample[], range: Range, now = Date.now()) {
  const { span, points } = RANGES[range];
  const step = Math.round(span / points);
  const end = Math.floor(now / step); // current incomplete bucket
  const start = end - points - 1;
  const per = new Map<number, Map<string, { n: number; cpu: number; mem: number; rx: number; tx: number }>>();
  for (const r of rows) {
    const b = Math.floor(r.ts / step);
    if (b < start || b >= end) continue;
    let m = per.get(b);
    if (!m) per.set(b, (m = new Map()));
    const s = m.get(r.server_id) ?? { n: 0, cpu: 0, mem: 0, rx: 0, tx: 0 };
    s.n++;
    s.cpu += r.cpu;
    s.mem += r.mem_pct;
    s.rx += r.rx_bps;
    s.tx += r.tx_bps;
    m.set(r.server_id, s);
  }
  const out: Record<SeriesKey, number[]> = { cpu: [], mem: [], rx: [], tx: [] };
  let last: Record<SeriesKey, number> | null = null;
  const buckets: (Record<SeriesKey, number> | null)[] = [];
  for (let b = start; b < end; b++) {
    const m = per.get(b);
    if (!m || m.size === 0) {
      buckets.push(null);
      continue;
    }
    const servers = [...m.values()];
    const v = {
      cpu: servers.reduce((a, s) => a + s.cpu / s.n, 0) / servers.length,
      mem: servers.reduce((a, s) => a + s.mem / s.n, 0) / servers.length,
      rx: servers.reduce((a, s) => a + s.rx / s.n, 0),
      tx: servers.reduce((a, s) => a + s.tx / s.n, 0),
    };
    buckets.push(v);
  }
  const firstKnown = buckets.find((b) => b) ?? { cpu: 0, mem: 0, rx: 0, tx: 0 };
  for (const b of buckets) {
    last = b ?? last ?? firstKnown;
    for (const k of Object.keys(out) as SeriesKey[]) out[k].push(Math.round(last[k] * 10) / 10);
  }
  return { ...out, stepMs: step, hasData: buckets.some(Boolean) };
}

async function samples(db: Kysely<DB>, since: number, serverId?: string) {
  let q = db.selectFrom("metrics").select(["server_id", "ts", "cpu", "mem_pct", "rx_bps", "tx_bps"]).where("ts", ">=", since);
  if (serverId) q = q.where("server_id", "=", serverId);
  return q.orderBy("ts").execute();
}

// ----------------------------------------------------------------- servers

export type ServerSummary = ReturnType<typeof summarize>;

function summarize(
  s: ServersTable,
  alerts: { server_id: string | null; severity: string; title: string; detail: string }[],
  vulns: { server_id: string; severity: string; n: number }[],
  spark: number[],
  now: number,
) {
  const m = parse<Metrics>(s.metrics);
  const u = parse<UpdateStatus>(s.updates);
  const mine = alerts.filter((a) => a.server_id === s.id && a.severity !== "info");
  const offline = now - s.last_seen_at > OFFLINE_AFTER_MS;
  const status: Health = offline ? "offline" : mine.some((a) => a.severity === "critical") ? "critical" : mine.length ? "warning" : "healthy";
  const top = mine.find((a) => a.severity === "critical") ?? mine[0];
  const pkgs = u?.packages ?? [];
  const v = vulns.filter((x) => x.server_id === s.id);
  const count = (sev: string) => v.filter((x) => x.severity === sev).reduce((a, x) => a + Number(x.n), 0);
  return {
    id: s.id,
    name: s.display_name || s.hostname,
    hostname: s.hostname,
    environment: s.environment,
    os: s.os_name || s.os_id,
    osId: s.os_id,
    kernel: s.kernel,
    arch: s.arch,
    cores: s.cpu_cores,
    memTotal: s.mem_total,
    ips: JSON.parse(s.ips) as string[],
    packageManager: s.package_manager,
    agentVersion: s.agent_version,
    sshUser: s.ssh_user,
    enrolledAt: s.enrolled_at,
    lastSeen: s.last_seen_at,
    status,
    issue: offline ? `No report for ${Math.round((now - s.last_seen_at) / 60_000)} min` : top ? `${top.title}: ${top.detail}` : null,
    uptimeSeconds: m?.uptime_seconds ?? 0,
    cpu: offline ? 0 : m?.cpu_percent ?? 0,
    mem: offline ? 0 : m?.mem_percent ?? 0,
    disk: Math.max(0, ...(m?.disks ?? []).map((d) => d.used_percent)),
    load1: m?.load1 ?? 0,
    rxBps: offline ? 0 : (m?.net ?? []).reduce((a, n) => a + n.rx_bytes_per_sec, 0),
    txBps: offline ? 0 : (m?.net ?? []).reduce((a, n) => a + n.tx_bytes_per_sec, 0),
    updates: pkgs.length,
    security: pkgs.filter((p) => p.security).length,
    rebootRequired: u?.reboot_required ?? false,
    updatesError: u?.error ?? null,
    vulns: { critical: count("critical"), high: count("high"), total: v.reduce((a, x) => a + Number(x.n), 0) },
    cveSupported: osvEcosystem(s.os_id, s.os_version) !== null,
    spark,
  };
}

export async function listServers(db: Kysely<DB>, now = Date.now()) {
  const [servers, alerts, vulns, recent] = await Promise.all([
    db.selectFrom("servers").selectAll().orderBy("hostname").execute(),
    db.selectFrom("alerts").select(["server_id", "severity", "title", "detail"]).where("status", "!=", "resolved").orderBy("last_seen", "desc").execute(),
    db.selectFrom("vulnerabilities").select((eb) => ["server_id", "severity", eb.fn.countAll<number>().as("n")]).where("status", "=", "open").groupBy(["server_id", "severity"]).execute(),
    samples(db, now - 5 * 60_000),
  ]);
  const spark = new Map<string, number[]>();
  for (const r of recent) {
    const a = spark.get(r.server_id) ?? [];
    a.push(r.cpu);
    spark.set(r.server_id, a);
  }
  return servers.map((s) => summarize(s, alerts, vulns, (spark.get(s.id) ?? []).slice(-31), now));
}

export async function serverDetail(db: Kysely<DB>, id: string, range: Range = "live", now = Date.now()) {
  const s = await db.selectFrom("servers").selectAll().where("id", "=", id).executeTakeFirst();
  if (!s) return null;
  const [alerts, vulnCounts, rows, logs, commands, runs, vulns] = await Promise.all([
    db.selectFrom("alerts").selectAll().where("server_id", "=", id).where("status", "!=", "resolved").orderBy("last_seen", "desc").execute(),
    db.selectFrom("vulnerabilities").select((eb) => ["server_id", "severity", eb.fn.countAll<number>().as("n")]).where("server_id", "=", id).where("status", "=", "open").groupBy(["server_id", "severity"]).execute(),
    samples(db, now - RANGES[range].span - RANGES[range].span / 20, id),
    db.selectFrom("logs").selectAll().where("server_id", "=", id).orderBy("ts", "desc").limit(50).execute(),
    db.selectFrom("commands").selectAll().where("server_id", "=", id).orderBy("created_at", "desc").limit(20).execute(),
    db.selectFrom("update_runs").selectAll().where("server_id", "=", id).orderBy("started_at", "desc").limit(10).execute(),
    db.selectFrom("vulnerabilities").selectAll().where("server_id", "=", id).where("status", "!=", "fixed").orderBy("score", "desc").execute(),
  ]);
  const m = parse<Metrics>(s.metrics);
  return {
    server: summarize(s, alerts, vulnCounts, rows.slice(-31).map((r) => r.cpu), now),
    series: bucketSeries(rows, range, now),
    disks: m?.disks ?? [],
    net: m?.net ?? [],
    swap: m ? { total: m.swap_total_bytes, used: m.swap_used_bytes } : null,
    apps: parse<Apps>(s.apps),
    updates: parse<UpdateStatus>(s.updates),
    alerts,
    logs,
    commands: commands.map((c) => ({ ...c, args: JSON.parse(c.args) })),
    runs: runs.map((r) => ({ ...r, packages: JSON.parse(r.packages) as string[] })),
    vulnerabilities: vulns.map((v) => ({ ...v, aliases: JSON.parse(v.aliases) as string[] })),
    cveScannedAt: s.cve_scanned_at,
    cveError: s.cve_error,
  };
}

// ---------------------------------------------------------------- overview

export async function overview(db: Kysely<DB>, range: Range = "live", now = Date.now()) {
  const span = RANGES[range].span;
  const [servers, rows, alerts, activity, policies] = await Promise.all([
    listServers(db, now),
    samples(db, now - span - span / 20),
    db.selectFrom("alerts").leftJoin("servers", "servers.id", "alerts.server_id").select(["alerts.id", "alerts.severity", "alerts.title", "alerts.detail", "alerts.status", "alerts.last_seen", "alerts.server_id", "servers.hostname"]).where("alerts.status", "!=", "resolved").orderBy("alerts.last_seen", "desc").limit(50).execute(),
    db.selectFrom("audit_log").selectAll().orderBy("ts", "desc").limit(8).execute(),
    db.selectFrom("update_policies").selectAll().orderBy("environment").execute(),
  ]);
  const online = servers.filter((s) => s.status !== "offline");
  const apps = await applications(db, servers);
  const memTotal = online.reduce((a, s) => a + s.memTotal, 0);
  const memUsed = online.reduce((a, s) => a + (s.memTotal * s.mem) / 100, 0);
  const rank = { critical: 4, offline: 3, warning: 2, healthy: 0 } as const;
  return {
    fleet: {
      total: servers.length,
      online: online.length,
      pendingUpdates: servers.reduce((a, s) => a + s.updates, 0),
      securityUpdates: servers.reduce((a, s) => a + s.security, 0),
      rebootRequired: servers.filter((s) => s.rebootRequired).length,
      openAlerts: alerts.filter((a) => a.status === "open").length,
      criticalAlerts: alerts.filter((a) => a.status === "open" && a.severity === "critical").length,
      vulnCritical: servers.reduce((a, s) => a + s.vulns.critical, 0),
      vulnHigh: servers.reduce((a, s) => a + s.vulns.high, 0),
      memUsed,
      memTotal,
    },
    series: bucketSeries(rows, range, now),
    attention: [...servers].sort((a, b) => rank[b.status] - rank[a.status] || b.security - a.security || Math.max(b.cpu, b.mem, b.disk) - Math.max(a.cpu, a.mem, a.disk)).slice(0, 7),
    alerts: alerts.slice(0, 6),
    critical: alerts.filter((a) => a.status === "open" && a.severity === "critical").slice(0, 4),
    apps: {
      docker: { total: apps.containers.length, running: apps.containers.filter((c) => c.state === "running").length, failing: apps.containers.filter((c) => c.state === "restarting" || c.health === "unhealthy").length },
      pm2: { total: apps.pm2.length, running: apps.pm2.filter((p) => p.status === "online").length, failing: apps.pm2.filter((p) => p.status === "errored").length },
      systemd: { total: apps.units.length, running: apps.units.filter((u) => u.active_state === "active").length, failing: apps.units.filter((u) => u.active_state === "failed").length },
    },
    policies: await Promise.all(
      policies.map(async (p) => ({
        id: p.id, name: p.name, environment: p.environment, enabled: p.enabled === 1, scope: p.scope, days: JSON.parse(p.days) as string[], start: p.start,
        timezone: p.timezone, intervalHours: p.interval_hours, servers: servers.filter((s) => s.environment === p.environment).length,
      })),
    ),
    activity,
  };
}

// ------------------------------------------------------------ applications

export async function applications(db: Kysely<DB>, summaries?: ServerSummary[]) {
  const servers = await db.selectFrom("servers").select(["id", "hostname", "display_name", "apps", "apps_at", "last_seen_at"]).execute();
  const names = new Map((summaries ?? []).map((s) => [s.id, s.name]));
  const now = Date.now();
  const containers = [];
  const pm2 = [];
  const units = [];
  const errors: { server: string; runtime: string; error: string }[] = [];
  for (const s of servers) {
    const apps = parse<Apps>(s.apps);
    if (!apps) continue;
    const server = { serverId: s.id, server: names.get(s.id) ?? (s.display_name || s.hostname), stale: now - s.last_seen_at > OFFLINE_AFTER_MS };
    if (apps.docker?.error) errors.push({ server: server.server, runtime: "docker", error: apps.docker.error });
    for (const c of apps.docker?.containers ?? []) containers.push({ ...c, ...server });
    for (const e of apps.pm2?.errors ?? []) errors.push({ server: server.server, runtime: "pm2", error: e });
    for (const p of apps.pm2?.processes ?? []) pm2.push({ ...p, ...server });
    if (apps.systemd?.error) errors.push({ server: server.server, runtime: "systemd", error: apps.systemd.error });
    for (const u of apps.systemd?.units ?? []) units.push({ ...u, ...server });
  }
  return { containers, pm2, units, errors };
}

// ----------------------------------------------------------------- updates

export async function updatesOverview(db: Kysely<DB>) {
  const [servers, policies, runs] = await Promise.all([
    listServers(db),
    db.selectFrom("update_policies").selectAll().orderBy("environment").execute(),
    db.selectFrom("update_runs").innerJoin("servers", "servers.id", "update_runs.server_id").select(["update_runs.id", "update_runs.server_id", "update_runs.trigger", "update_runs.started_at", "update_runs.finished_at", "update_runs.status", "update_runs.packages", "update_runs.error", "update_runs.reboot_scheduled", "servers.hostname", "servers.display_name"]).orderBy("update_runs.started_at", "desc").limit(25).execute(),
  ]);
  const rows = await db.selectFrom("servers").select(["id", "updates"]).execute();
  const byId = new Map(servers.map((s) => [s.id, s]));
  const pkgs = new Map<string, { name: string; available: string; current: string[]; security: boolean; advisory: string | null; manager: string; servers: { id: string; name: string; current: string }[] }>();
  let lastCheck = 0;
  for (const r of rows) {
    const u = parse<UpdateStatus>(r.updates);
    if (!u) continue;
    lastCheck = Math.max(lastCheck, Date.parse(u.checked_at) || 0);
    for (const p of u.packages ?? []) {
      const key = `${p.name}@${p.available}`;
      const e = pkgs.get(key) ?? { name: p.name, available: p.available, current: [], security: false, advisory: null, manager: u.manager, servers: [] };
      e.security ||= p.security;
      e.advisory ||= p.advisory ?? null;
      if (p.current && !e.current.includes(p.current)) e.current.push(p.current);
      e.servers.push({ id: r.id, name: byId.get(r.id)?.name ?? r.id, current: p.current ?? "" });
      pkgs.set(key, e);
    }
  }
  return {
    kpis: {
      pending: servers.reduce((a, s) => a + s.updates, 0),
      security: servers.reduce((a, s) => a + s.security, 0),
      rebootRequired: servers.filter((s) => s.rebootRequired).map((s) => ({ id: s.id, name: s.name })),
      lastCheck,
      lastRun: runs[0] ? { ...runs[0], server: runs[0].display_name || runs[0].hostname } : null,
    },
    packages: [...pkgs.values()].sort((a, b) => Number(b.security) - Number(a.security) || b.servers.length - a.servers.length || a.name.localeCompare(b.name)),
    servers: servers.map((s) => ({ id: s.id, name: s.name, environment: s.environment, status: s.status, updates: s.updates, security: s.security, rebootRequired: s.rebootRequired, error: s.updatesError, packageManager: s.packageManager })),
    policies: policies.map((p) => ({ ...p, enabled: p.enabled === 1, auto_reboot: p.auto_reboot === 1, days: JSON.parse(p.days) as string[], exclude: JSON.parse(p.exclude) as string[], servers: servers.filter((s) => s.environment === p.environment).length })),
    runs: runs.map((r) => ({ ...r, server: r.display_name || r.hostname, packages: JSON.parse(r.packages) as string[] })),
  };
}

// ------------------------------------------------------------- alerts/logs

export async function alertsList(db: Kysely<DB>, includeResolved: boolean) {
  let q = db
    .selectFrom("alerts")
    .leftJoin("servers", "servers.id", "alerts.server_id")
    .leftJoin("users", "users.id", "alerts.acknowledged_by")
    .select(["alerts.id", "alerts.fingerprint", "alerts.server_id", "alerts.severity", "alerts.source", "alerts.title", "alerts.detail", "alerts.status", "alerts.first_seen", "alerts.last_seen", "alerts.acknowledged_at", "alerts.resolved_at", "servers.hostname", "servers.display_name", "users.name as acknowledged_by_name"])
    .orderBy("alerts.last_seen", "desc")
    .limit(500);
  if (!includeResolved) q = q.where("alerts.status", "!=", "resolved");
  const [alerts, rules] = await Promise.all([q.execute(), db.selectFrom("alert_rules").selectAll().orderBy("id").execute()]);
  return { alerts: alerts.map((a) => ({ ...a, server: a.display_name || a.hostname })), rules };
}

export async function logsList(db: Kysely<DB>, opts: { serverId?: string; minPriority?: number; limit?: number }) {
  let q = db
    .selectFrom("logs")
    .innerJoin("servers", "servers.id", "logs.server_id")
    .select(["logs.id", "logs.ts", "logs.priority", "logs.unit", "logs.message", "logs.server_id", "servers.hostname", "servers.display_name"])
    .orderBy("logs.ts", "desc")
    .limit(Math.min(opts.limit ?? 200, 1000));
  if (opts.serverId) q = q.where("logs.server_id", "=", opts.serverId);
  if (opts.minPriority !== undefined) q = q.where("logs.priority", "<=", opts.minPriority);
  return (await q.execute()).map((l) => ({ ...l, server: l.display_name || l.hostname }));
}

// --------------------------------------------------------- vulnerabilities

export async function vulnerabilitiesList(db: Kysely<DB>, includeFixed: boolean) {
  let q = db
    .selectFrom("vulnerabilities")
    .innerJoin("servers", "servers.id", "vulnerabilities.server_id")
    .select(["vulnerabilities.id", "vulnerabilities.server_id", "vulnerabilities.package", "vulnerabilities.binaries", "vulnerabilities.installed_version", "vulnerabilities.fixed_version", "vulnerabilities.vuln_id", "vulnerabilities.aliases", "vulnerabilities.severity", "vulnerabilities.score", "vulnerabilities.summary", "vulnerabilities.url", "vulnerabilities.origin", "vulnerabilities.status", "vulnerabilities.first_seen", "vulnerabilities.ignored_reason", "servers.hostname", "servers.display_name", "servers.environment"]);
  if (!includeFixed) q = q.where("vulnerabilities.status", "!=", "fixed");
  const rows = await q.execute();
  const order = { critical: 0, high: 1, medium: 2, low: 3, unknown: 4 } as const;
  const groups = new Map<string, { key: string; vulnId: string; package: string; severity: keyof typeof order; score: number | null; summary: string; url: string; origin: string; aliases: string[]; fixed: string | null; firstSeen: number; affected: { id: string; serverId: string; server: string; environment: string; installed: string; fixed: string | null; binaries: string; status: string; ignoredReason: string | null }[] }>();
  for (const r of rows) {
    const key = `${r.vuln_id}|${r.package}`;
    const g = groups.get(key) ?? {
      key, vulnId: r.vuln_id, package: r.package, severity: r.severity, score: r.score, summary: r.summary, url: r.url, origin: r.origin,
      aliases: JSON.parse(r.aliases) as string[], fixed: r.fixed_version, firstSeen: r.first_seen, affected: [],
    };
    g.firstSeen = Math.min(g.firstSeen, r.first_seen);
    // The same CVE can come from several distros; keep the worst rating.
    if ((r.score ?? 0) > (g.score ?? 0)) Object.assign(g, { score: r.score, severity: r.severity });
    if (order[r.severity] < order[g.severity]) g.severity = r.severity;
    if (g.fixed !== r.fixed_version) g.fixed = g.affected.length ? null : r.fixed_version;
    g.affected.push({ id: r.id, serverId: r.server_id, server: r.display_name || r.hostname, environment: r.environment, installed: r.installed_version, fixed: r.fixed_version, binaries: r.binaries, status: r.status, ignoredReason: r.ignored_reason });
    groups.set(key, g);
  }
  const list = [...groups.values()].sort((a, b) => order[a.severity] - order[b.severity] || (b.score ?? 0) - (a.score ?? 0) || b.affected.length - a.affected.length);
  const open = rows.filter((r) => r.status === "open");
  const servers = await db.selectFrom("servers").select(["id", "hostname", "display_name", "os_id", "os_version", "cve_scanned_at", "cve_error"]).execute();
  const s = await getSettings(db);
  return {
    kpis: {
      critical: open.filter((r) => r.severity === "critical").length,
      high: open.filter((r) => r.severity === "high").length,
      medium: open.filter((r) => r.severity === "medium").length,
      other: open.filter((r) => r.severity === "low" || r.severity === "unknown").length,
      affectedServers: new Set(open.map((r) => r.server_id)).size,
    },
    vulnerabilities: list,
    coverage: servers.map((x) => ({ id: x.id, name: x.display_name || x.hostname, ecosystem: osvEcosystem(x.os_id, x.os_version), scannedAt: x.cve_scanned_at, error: x.cve_error })),
    lastScanAt: Number(s.cve_last_scan_at) || null,
    lastError: s.cve_last_error || null,
    enabled: s.cve_scan_enabled === "1",
  };
}
