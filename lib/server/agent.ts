/**
 * Control-plane side of the agent protocol (see linux-dash-agent/docs/PROTOCOL.md):
 * enrolment, authentication, report ingestion and command delivery.
 */
import zlib from "node:zlib";
import type { Kysely } from "kysely";
import type { Command, Policy, Report, ReportResponse } from "./agent-protocol";
import { evaluateReport } from "./alerts";
import { ApiError } from "./api";
import { newId, randomToken, safeEqual, sha256 } from "./crypto";
import type { DB, ServersTable, UpdatePoliciesTable } from "./schema";
import { audit } from "./settings";

const MAX_BODY = 16 << 20;

export async function readAgentBody(req: Request): Promise<unknown> {
  const raw = Buffer.from(await req.arrayBuffer());
  if (raw.length > MAX_BODY) throw new ApiError(413, "Body too large");
  let body = raw;
  if ((req.headers.get("content-encoding") ?? "").includes("gzip")) {
    try {
      body = zlib.gunzipSync(raw, { maxOutputLength: MAX_BODY });
    } catch {
      throw new ApiError(400, "Invalid gzip body");
    }
  }
  try {
    return JSON.parse(body.toString("utf8"));
  } catch {
    throw new ApiError(400, "Invalid JSON");
  }
}

const clip = (v: unknown, n = 200) => (typeof v === "string" ? v.slice(0, n) : "");
const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : 0);
const ts = (v: unknown) => {
  const t = typeof v === "string" ? Date.parse(v) : NaN;
  return Number.isFinite(t) && t > 0 ? t : null;
};

function hostColumns(h: Report["host"] | undefined) {
  const host = h ?? ({} as Report["host"]);
  return {
    hostname: clip(host.hostname, 253) || "unknown",
    os_name: clip(host.os_name),
    os_id: clip(host.os_id, 50),
    os_version: clip(host.os_version, 50),
    kernel: clip(host.kernel),
    arch: clip(host.arch, 20),
    cpu_cores: Math.trunc(num(host.cpu_cores)),
    mem_total: num(host.mem_total_bytes),
    ips: JSON.stringify((Array.isArray(host.ips) ? host.ips : []).slice(0, 32).map((ip) => clip(ip, 64))),
    package_manager: clip(host.package_manager, 20),
    boot_time: ts(host.boot_time),
  };
}

// ---------------------------------------------------------------- enrolment

export async function enroll(db: Kysely<DB>, body: unknown): Promise<{ agent_id: string; secret: string }> {
  const b = (body ?? {}) as { token?: unknown; agent_version?: unknown; host?: Report["host"] };
  if (typeof b.token !== "string" || !b.token) throw new ApiError(401, "Enrolment token required");
  const token = await db.selectFrom("enrollment_tokens").selectAll().where("token_hash", "=", sha256(b.token)).executeTakeFirst();
  const now = Date.now();
  if (!token || token.revoked || (token.expires_at && token.expires_at < now) || (token.max_uses !== null && token.uses >= token.max_uses)) {
    throw new ApiError(401, "Invalid, expired or used-up enrolment token");
  }
  const secret = randomToken(32);
  const id = newId("srv");
  const host = hostColumns(b.host);
  await db
    .insertInto("servers")
    .values({
      id, secret_hash: sha256(secret), ...host, display_name: null, environment: token.environment, agent_version: clip(b.agent_version, 40),
      ssh_user: null, enrolled_at: now, last_seen_at: now, metrics: null, apps: null, apps_at: null, updates: null, updates_at: null,
      packages_hash: null, cve_scanned_at: null, cve_error: null,
    })
    .execute();
  await db.updateTable("enrollment_tokens").set({ uses: token.uses + 1, last_used_at: now }).where("id", "=", token.id).execute();
  await audit(db, null, "server.enrolled", host.hostname, `${host.os_name || "unknown OS"} via token “${token.label}”`);
  return { agent_id: id, secret };
}

export async function authenticateAgent(db: Kysely<DB>, req: Request): Promise<ServersTable> {
  const id = req.headers.get("x-agent-id") ?? "";
  const auth = req.headers.get("authorization") ?? "";
  const secret = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (!id || !secret) throw new ApiError(401, "Agent credentials required");
  const server = await db.selectFrom("servers").selectAll().where("id", "=", id).executeTakeFirst();
  if (!server || !safeEqual(sha256(secret), server.secret_hash)) throw new ApiError(401, "Unknown agent or bad secret");
  return server;
}

// ------------------------------------------------------------------ reports

export function policyForAgent(p: UpdatePoliciesTable | undefined): Policy | undefined {
  if (!p) return undefined;
  const base = { enabled: p.enabled === 1, scope: p.scope, auto_reboot: p.auto_reboot === 1, exclude: JSON.parse(p.exclude) as string[] };
  if (p.interval_hours > 0 && !p.start) return { ...base, interval_hours: p.interval_hours };
  return { ...base, window: { days: JSON.parse(p.days) as string[], start: p.start || "02:00", duration_minutes: p.duration_minutes, timezone: p.timezone } };
}

export type IngestResult = { response: ReportResponse; packagesChanged: boolean };

export async function ingestReport(db: Kysely<DB>, server: ServersTable, body: unknown): Promise<IngestResult> {
  const rep = (body ?? {}) as Report;
  const now = Date.now();
  const host = hostColumns(rep.host);

  // Latest state on the server row.
  const patch: Partial<ServersTable> = { ...host, agent_version: clip(rep.agent_version, 40) || server.agent_version, last_seen_at: now };
  if (rep.metrics) patch.metrics = JSON.stringify(rep.metrics);
  if (rep.apps) {
    patch.apps = JSON.stringify(rep.apps);
    patch.apps_at = now;
  }
  let packagesChanged = false;
  if (rep.updates) {
    patch.updates = JSON.stringify(rep.updates);
    patch.updates_at = now;
    const pkgs = (rep.updates.packages ?? []).map((p) => `${p.name}=${p.current ?? ""}>${p.available}`).sort();
    const hash = sha256(pkgs.join("\n"));
    if (hash !== server.packages_hash) {
      patch.packages_hash = hash;
      packagesChanged = true;
    }
  }
  await db.updateTable("servers").set(patch).where("id", "=", server.id).execute();

  // Time series sample.
  if (rep.metrics) {
    const m = rep.metrics;
    const net = (m.net ?? []).reduce((acc, n) => ({ rx: acc.rx + num(n.rx_bytes_per_sec), tx: acc.tx + num(n.tx_bytes_per_sec) }), { rx: 0, tx: 0 });
    const diskMax = Math.max(0, ...(m.disks ?? []).map((d) => num(d.used_percent)));
    await db
      .insertInto("metrics")
      .values({
        server_id: server.id, ts: now, cpu: num(m.cpu_percent), iowait: num(m.cpu_iowait_percent), mem_pct: num(m.mem_percent),
        swap_pct: m.swap_total_bytes ? (num(m.swap_used_bytes) / m.swap_total_bytes) * 100 : 0, load1: num(m.load1),
        rx_bps: net.rx, tx_bps: net.tx, disk_pct: diskMax,
      })
      .execute();
  }

  // Journal entries.
  const logs = (rep.logs ?? []).slice(-500);
  if (logs.length) {
    await db
      .insertInto("logs")
      .values(logs.map((l) => ({ id: newId("log"), server_id: server.id, ts: ts(l.time) ?? now, priority: Math.trunc(num(l.priority)), unit: clip(l.unit, 200), message: clip(l.message, 2000) })))
      .execute();
  }

  // Command results.
  for (const r of rep.results ?? []) {
    if (typeof r?.id !== "string") continue;
    await db
      .updateTable("commands")
      .set({ status: r.ok ? "succeeded" : "failed", finished_at: ts(r.finished_at) ?? now, output: clip(r.output, 20000) || null, error: clip(r.error, 2000) || null })
      .where("id", "=", r.id)
      .where("server_id", "=", server.id)
      .where("status", "in", ["pending", "delivered", "expired"]) // late results still count
      .execute();
  }

  // Update run history.
  const run = rep.updates?.last_run;
  const started = ts(run?.started_at);
  if (run && started) {
    await db
      .insertInto("update_runs")
      .values({
        id: newId("run"), server_id: server.id, trigger: clip(run.trigger, 20), started_at: started, finished_at: ts(run.finished_at) ?? started,
        status: clip(run.status, 20), packages: JSON.stringify((run.packages ?? []).slice(0, 2000)), error: clip(run.error, 2000) || null,
        reboot_scheduled: run.reboot_scheduled ? 1 : 0,
      })
      .onConflict((oc) => oc.columns(["server_id", "started_at"]).doNothing())
      .execute();
  }

  await evaluateReport(db, { id: server.id, hostname: host.hostname }, rep);

  // Commands to deliver: everything pending or delivered without a result yet.
  await db.updateTable("commands").set({ status: "expired" }).where("server_id", "=", server.id).where("status", "in", ["pending", "delivered"]).where("expires_at", "<", now).execute();
  const pending = await db
    .selectFrom("commands")
    .select(["id", "type", "args", "created_at"])
    .where("server_id", "=", server.id)
    .where("status", "in", ["pending", "delivered"])
    .orderBy("created_at")
    .limit(50)
    .execute();
  if (pending.length) {
    // Once delivered, allow long-running work (upgrades) up to 2 h to report back.
    await db
      .updateTable("commands")
      .set({ status: "delivered", delivered_at: now, expires_at: now + 2 * 3_600_000 })
      .where("server_id", "=", server.id)
      .where("status", "=", "pending")
      .execute();
  }
  const commands: Command[] = pending.map((c) => ({ id: c.id, type: c.type, args: JSON.parse(c.args), issued_at: new Date(c.created_at).toISOString() }));

  // The policy is sent every time; the agent ignores it when unchanged.
  const policyRow = await db.selectFrom("update_policies").selectAll().where("environment", "=", server.environment).executeTakeFirst();

  return { response: { commands, policy: policyForAgent(policyRow) }, packagesChanged };
}

// ----------------------------------------------------------------- commands

export async function queueCommand(
  db: Kysely<DB>,
  opts: { serverId: string; type: string; args: unknown; label: string; user: { id: string; name: string } | null; ttlMinutes?: number },
) {
  const now = Date.now();
  const id = newId("cmd");
  await db
    .insertInto("commands")
    .values({
      id, server_id: opts.serverId, type: opts.type, args: JSON.stringify(opts.args ?? {}), status: "pending", label: opts.label.slice(0, 200),
      created_by: opts.user?.id ?? null, created_by_name: opts.user?.name ?? "System", created_at: now,
      expires_at: now + (opts.ttlMinutes ?? 15) * 60_000, delivered_at: null, finished_at: null, output: null, error: null,
    })
    .execute();
  return id;
}
