/**
 * Alert lifecycle. Each condition has a stable fingerprint (e.g.
 * "disk:<server>:/var"); raising an already-open fingerprint refreshes it,
 * and conditions that clear are resolved automatically.
 */
import type { Kysely } from "kysely";
import type { Report } from "./agent-protocol";
import { newId } from "./crypto";
import { notifyAlert } from "./notify";
import type { AlertRulesTable, DB, ServersTable, Severity } from "./schema";

export type RaiseInput = { fingerprint: string; serverId: string | null; severity: Severity; source: string; title: string; detail: string };

export async function raise(db: Kysely<DB>, a: RaiseInput, hostname?: string) {
  const now = Date.now();
  const existing = await db
    .selectFrom("alerts")
    .select(["id", "status"])
    .where("fingerprint", "=", a.fingerprint)
    .where("status", "!=", "resolved")
    .executeTakeFirst();
  if (existing) {
    await db.updateTable("alerts").set({ last_seen: now, detail: a.detail, title: a.title, severity: a.severity }).where("id", "=", existing.id).execute();
    return { id: existing.id, created: false };
  }
  const row = {
    id: newId("alt"), fingerprint: a.fingerprint, server_id: a.serverId, severity: a.severity, source: a.source, title: a.title, detail: a.detail,
    status: "open" as const, first_seen: now, last_seen: now, acknowledged_by: null, acknowledged_at: null, resolved_at: null,
  };
  await db.insertInto("alerts").values(row).execute();
  await notifyAlert(db, row, hostname);
  return { id: row.id, created: true };
}

export async function resolve(db: Kysely<DB>, fingerprint: string) {
  await db.updateTable("alerts").set({ status: "resolved", resolved_at: Date.now() }).where("fingerprint", "=", fingerprint).where("status", "!=", "resolved").execute();
}

/** Resolve a server's open alerts whose fingerprint starts with prefix, except those in keep. */
export async function resolveMissing(db: Kysely<DB>, serverId: string, prefix: string, keep: Set<string>) {
  const open = await db.selectFrom("alerts").select("fingerprint").where("server_id", "=", serverId).where("status", "!=", "resolved").execute();
  for (const { fingerprint } of open) if (fingerprint.startsWith(prefix) && !keep.has(fingerprint)) await resolve(db, fingerprint);
}

export async function loadRules(db: Kysely<DB>) {
  const rows = await db.selectFrom("alert_rules").selectAll().execute();
  return Object.fromEntries(rows.map((r) => [r.kind, r])) as Partial<Record<AlertRuleKindKey, AlertRulesTable>>;
}
type AlertRuleKindKey = AlertRulesTable["kind"];

/** Evaluate every rule that depends on an incoming report. */
export async function evaluateReport(db: Kysely<DB>, server: Pick<ServersTable, "id" | "hostname">, rep: Report) {
  const rules = await loadRules(db);
  const sid = server.id;
  const host = server.hostname;
  const on = (k: AlertRuleKindKey) => (rules[k]?.enabled ? rules[k] : undefined);

  await resolve(db, `offline:${sid}`);

  // Sustained CPU / memory.
  for (const [kind, column, label] of [["cpu", "cpu", "CPU"], ["memory", "mem_pct", "Memory"]] as const) {
    const rule = on(kind);
    const fp = `${kind}:${sid}`;
    if (!rule || !rep.metrics) {
      if (!rule) await resolve(db, fp);
      continue;
    }
    const latest = kind === "cpu" ? rep.metrics.cpu_percent : rep.metrics.mem_percent;
    let breached = latest >= rule.threshold;
    if (breached && rule.duration_minutes > 0) {
      const windowMs = rule.duration_minutes * 60_000;
      const since = Date.now() - windowMs;
      const agg = await db
        .selectFrom("metrics")
        .select((eb) => [eb.fn.min(column).as("lo"), eb.fn.min("ts").as("first"), eb.fn.countAll().as("n")])
        .where("server_id", "=", sid)
        .where("ts", ">=", since)
        .executeTakeFirst();
      const covered = agg && Number(agg.n) >= 2 && Number(agg.first) <= since + windowMs * 0.2;
      breached = Boolean(covered && Number(agg!.lo) >= rule.threshold);
    }
    if (breached) {
      const dur = rule.duration_minutes > 0 ? ` for over ${rule.duration_minutes} min` : "";
      await raise(db, { fingerprint: fp, serverId: sid, severity: rule.severity, source: kind, title: `High ${label.toLowerCase()} usage`, detail: `${label} at ${latest.toFixed(0)}% (above ${rule.threshold}%${dur})` }, host);
    } else if (latest < rule.threshold) {
      await resolve(db, fp);
    }
  }

  // Disk usage, per mount.
  const disk = on("disk");
  if (rep.metrics) {
    const keep = new Set<string>();
    if (disk) {
      for (const d of rep.metrics.disks ?? []) {
        if (d.used_percent < disk.threshold) continue;
        const fp = `disk:${sid}:${d.mount}`;
        keep.add(fp);
        const freeGb = (d.free_bytes / 1024 ** 3).toFixed(1);
        await raise(db, { fingerprint: fp, serverId: sid, severity: disk.severity, source: "disk", title: "Disk almost full", detail: `${d.mount} at ${d.used_percent.toFixed(0)}% (${freeGb} GB free)` }, host);
      }
    }
    await resolveMissing(db, sid, `disk:${sid}:`, keep);
  }

  if (rep.apps) {
    const keep = new Set<string>();
    const container = on("container");
    if (container && rep.apps.docker) {
      for (const c of rep.apps.docker.containers ?? []) {
        const fp = `container:${sid}:${c.name}`;
        if (c.state === "restarting") {
          keep.add(fp);
          const oom = c.oom_killed ? ", last exit OOM-killed" : c.exit_code ? `, last exit code ${c.exit_code}` : "";
          await raise(db, { fingerprint: fp, serverId: sid, severity: container.severity, source: "docker", title: "Container crash loop", detail: `${c.name} is restarting (${c.restart_count} restarts${oom})` }, host);
        } else if (c.health === "unhealthy") {
          keep.add(fp);
          await raise(db, { fingerprint: fp, serverId: sid, severity: "warning", source: "docker", title: "Container unhealthy", detail: `${c.name} health check failing` }, host);
        }
      }
    }
    await resolveMissing(db, sid, `container:${sid}:`, keep);

    keep.clear();
    const pm2 = on("pm2");
    if (pm2 && rep.apps.pm2) {
      for (const p of rep.apps.pm2.processes ?? []) {
        if (p.status !== "errored") continue;
        const fp = `pm2:${sid}:${p.user}:${p.name}`;
        keep.add(fp);
        await raise(db, { fingerprint: fp, serverId: sid, severity: pm2.severity, source: "pm2", title: "PM2 app errored", detail: `${p.name}${p.user ? ` (user ${p.user})` : ""} errored after ${p.restarts} restarts` }, host);
      }
    }
    await resolveMissing(db, sid, `pm2:${sid}:`, keep);

    keep.clear();
    const systemd = on("systemd");
    if (systemd && rep.apps.systemd) {
      for (const u of rep.apps.systemd.units ?? []) {
        if (u.active_state !== "failed") continue;
        const fp = `systemd:${sid}:${u.name}`;
        keep.add(fp);
        await raise(db, { fingerprint: fp, serverId: sid, severity: systemd.severity, source: "systemd", title: "Service failed", detail: `${u.name} entered failed state${u.description ? ` (${u.description})` : ""}` }, host);
      }
    }
    await resolveMissing(db, sid, `systemd:${sid}:`, keep);
  }

  if (rep.updates) {
    const failed = on("update_failed");
    const run = rep.updates.last_run;
    if (failed && run?.status === "failed") {
      await raise(db, { fingerprint: `update:${sid}`, serverId: sid, severity: failed.severity, source: "updates", title: "Update run failed", detail: run.error || "The package manager reported an error" }, host);
    } else if (run?.status === "success" || !failed) {
      await resolve(db, `update:${sid}`);
    }

    const reboot = on("reboot_required");
    if (reboot && rep.updates.reboot_required) {
      await raise(db, { fingerprint: `reboot:${sid}`, serverId: sid, severity: reboot.severity, source: "updates", title: "Reboot required", detail: "Updates were installed that need a reboot to take effect" }, host);
    } else {
      await resolve(db, `reboot:${sid}`);
    }
  }
}

/** Raise alerts for agents that stopped reporting. Run periodically. */
export async function checkOffline(db: Kysely<DB>, now = Date.now()) {
  const rule = (await loadRules(db)).offline;
  if (!rule?.enabled) return;
  const cutoff = now - Math.max(1, rule.duration_minutes) * 60_000;
  const stale = await db.selectFrom("servers").select(["id", "hostname", "last_seen_at"]).where("last_seen_at", "<", cutoff).execute();
  for (const s of stale) {
    const mins = Math.round((now - s.last_seen_at) / 60_000);
    await raise(db, { fingerprint: `offline:${s.id}`, serverId: s.id, severity: rule.severity, source: "agent", title: "Server not reporting", detail: `No report from the agent for ${mins} min` }, s.hostname);
  }
}
