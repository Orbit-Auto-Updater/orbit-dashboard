/**
 * Update jobs: one job per "install updates" action (or scheduled run), with
 * a target per server. Agents stream each target's output, phase and
 * installed packages through /api/agent/v1/progress while the run executes.
 */
import type { Kysely } from "kysely";
import type { AgentInfo, Progress, UpdateStatus } from "./agent-protocol";
import { agentRelease, compareVersions, type AgentArch } from "./dist";
import { ApiError, badRequest } from "./api";
import { queueCommand, validateCommand } from "./commands";
import { newId } from "./crypto";
import type { CommandsTable, DB, JobTargetStatus, ServersTable } from "./schema";
import { audit } from "./settings";

const MAX_LINES_PER_TARGET = 20_000;
const MAX_LINE = 2000;
const LOST_AFTER_MS = 2 * 3_600_000;

export const FINISHED: JobTargetStatus[] = ["succeeded", "failed", "skipped", "expired"];
const ts = (v: unknown) => {
  const t = typeof v === "string" ? Date.parse(v) : NaN;
  return Number.isFinite(t) && t > 0 ? t : Date.now();
};

type Installed = { name: string; version?: string; t: number };

// ------------------------------------------------------------------ create

export type UpdateJobInput = { serverIds: string[] | "all"; packages?: string[]; securityOnly?: boolean };

/** Queue updates.apply on each server and group the commands into a job. */
export async function createUpdateJob(db: Kysely<DB>, user: { id: string; name: string }, input: UpdateJobInput) {
  const packages = input.packages ?? [];
  let q = db.selectFrom("servers").select(["id", "hostname", "display_name", "updates"]);
  if (input.serverIds !== "all") q = q.where("id", "in", input.serverIds.length ? input.serverIds : ["-"]);
  const servers = await q.execute();
  const targets: { server: (typeof servers)[number]; args: Record<string, unknown> }[] = [];
  for (const s of servers) {
    const pending = ((s.updates ? (JSON.parse(s.updates) as UpdateStatus).packages : []) ?? []).map((p) => p.name);
    const wanted = packages.filter((p) => pending.includes(p));
    if (packages.length && !wanted.length) continue; // nothing requested is pending here
    targets.push({ server: s, args: { packages: wanted.length ? wanted : undefined, security_only: input.securityOnly || undefined } });
  }
  if (!targets.length) throw badRequest("None of the selected servers have those updates pending");

  const label = packages.length
    ? `Install ${packages.length === 1 ? packages[0] : `${packages.length} packages`}`
    : input.securityOnly ? "Install security updates" : "Install all updates";
  const now = Date.now();
  const jobId = newId("job");
  await db
    .insertInto("jobs")
    .values({ id: jobId, kind: "updates.apply", label, trigger: "manual", args: JSON.stringify({ packages: packages.length ? packages : undefined, security_only: input.securityOnly || undefined }), created_by: user.id, created_by_name: user.name, created_at: now })
    .execute();
  const commands: { serverId: string; commandId: string }[] = [];
  for (const t of targets) {
    const cmd = validateCommand("updates.apply", t.args);
    const commandId = await queueCommand(db, { serverId: t.server.id, type: cmd.type, args: cmd.args, label: cmd.label, user });
    await db
      .insertInto("job_targets")
      .values({ id: newId("jt"), job_id: jobId, server_id: t.server.id, command_id: commandId, run_id: null, status: "queued", phase: "", total: 0, installed: "[]", log_lines: 0, started_at: null, finished_at: null, error: null, updated_at: now })
      .execute();
    commands.push({ serverId: t.server.id, commandId });
  }
  await audit(db, user, "updates.apply", `${targets.length} server(s)`, label);
  return { jobId, queued: commands.length, commands };
}

// ------------------------------------------------------------------ ingest

function mapStatus(status: string | undefined): JobTargetStatus {
  if (status === "success") return "succeeded";
  if (status === "skipped") return "skipped";
  return "failed";
}

function str(v: unknown, max: number) {
  return typeof v === "string" ? v.slice(0, max) : "";
}

/** Record one progress chunk from an agent. Idempotent: lines are keyed by seq. */
export async function ingestProgress(db: Kysely<DB>, server: Pick<ServersTable, "id" | "environment">, body: unknown) {
  const p = (body ?? {}) as Progress;
  const runId = str(p.run_id, 64);
  if (!/^run_[A-Za-z0-9_-]{4,60}$/.test(runId)) throw new ApiError(400, "Invalid run_id");
  const seq = Number.isInteger(p.seq) && p.seq >= 0 ? p.seq : 0;
  const lines = Array.isArray(p.lines) ? p.lines.slice(0, 5000) : [];
  const commandId = str(p.command_id, 64) || null;
  const now = Date.now();

  let target = commandId
    ? await db.selectFrom("job_targets").selectAll().where("command_id", "=", commandId).where("server_id", "=", server.id).executeTakeFirst()
    : undefined;
  target ??= await db.selectFrom("job_targets").selectAll().where("server_id", "=", server.id).where("run_id", "=", runId).executeTakeFirst();

  if (!target) {
    // A run the dashboard didn't start: a scheduled run from the update policy
    // (or a command queued before jobs existed).
    const policy = await db.selectFrom("update_policies").select("name").where("environment", "=", server.environment).executeTakeFirst();
    const jobId = newId("job");
    const scheduled = p.trigger === "schedule";
    await db
      .insertInto("jobs")
      .values({ id: jobId, kind: str(p.kind, 40) || "updates.apply", label: scheduled ? `Scheduled updates${policy ? ` (${policy.name})` : ""}` : "Install updates", trigger: scheduled ? "schedule" : "manual", args: "{}", created_by: null, created_by_name: scheduled ? "Auto-update policy" : "Dashboard", created_at: ts(p.started_at) })
      .execute();
    target = {
      id: newId("jt"), job_id: jobId, server_id: server.id, command_id: commandId, run_id: runId, status: "running", phase: "", total: 0, installed: "[]",
      log_lines: 0, started_at: ts(p.started_at), finished_at: null, error: null, updated_at: now,
    };
    await db.insertInto("job_targets").values(target).execute();
  }

  // Log lines (re-sent chunks hit the primary key and are ignored).
  const rows = lines
    .map((l, i) => ({ target_id: target!.id, seq: seq + i, ts: ts(l?.t), stream: str(l?.s, 10) || "stdout", text: str(l?.text, MAX_LINE) }))
    .filter((r) => r.seq < MAX_LINES_PER_TARGET);
  for (let i = 0; i < rows.length; i += 500) {
    await db.insertInto("job_logs").values(rows.slice(i, i + 500)).onConflict((oc) => oc.columns(["target_id", "seq"]).doNothing()).execute();
  }

  // Installed packages, de-duplicated by name.
  const installed = JSON.parse(target.installed) as Installed[];
  const names = new Set(installed.map((x) => x.name));
  for (const pkg of Array.isArray(p.installed) ? p.installed.slice(0, 5000) : []) {
    const name = str(pkg?.name, 200);
    if (name && !names.has(name)) {
      names.add(name);
      installed.push({ name, version: str(pkg?.version, 200) || undefined, t: ts(pkg?.t) });
    }
  }

  const finished = FINISHED.includes(target.status);
  const patch: Partial<typeof target> = {
    run_id: runId,
    phase: str(p.phase, 30) || target.phase,
    total: Math.max(target.total, Number.isInteger(p.total) ? Math.min(p.total!, 100_000) : 0),
    installed: JSON.stringify(installed),
    log_lines: Math.max(target.log_lines, Math.min(seq + lines.length, MAX_LINES_PER_TARGET)),
    started_at: target.started_at ?? ts(p.started_at),
    updated_at: now,
  };
  if (p.done && p.kind === "agent.update" && p.status === "success") {
    // Installed; the job completes when the server reports the new version.
    Object.assign(patch, { status: "running", phase: "restarting" });
  } else if (p.done) {
    Object.assign(patch, { status: mapStatus(p.status), finished_at: now, error: str(p.error, 2000) || null, phase: "done" });
  } else if (!finished) {
    patch.status = "running";
  }
  await db.updateTable("job_targets").set(patch).where("id", "=", target.id).execute();
  return { targetId: target.id, jobId: target.job_id };
}

/**
 * Finish a target from its command result. This covers agents that don't
 * stream progress (their final output becomes the log) and lost final chunks.
 */
export async function finishFromCommand(db: Kysely<DB>, command: Pick<CommandsTable, "id" | "type">, ok: boolean, output: string | null, error: string | null) {
  const target = await db.selectFrom("job_targets").selectAll().where("command_id", "=", command.id).executeTakeFirst();
  if (!target || FINISHED.includes(target.status)) return;
  const now = Date.now();
  if (command.type === "agent.update" && ok && !/^already running/.test(output ?? "")) {
    await db.updateTable("job_targets").set({ phase: "restarting", status: "running", updated_at: now, started_at: target.started_at ?? now }).where("id", "=", target.id).execute();
    return;
  }
  if (!target.run_id && output) {
    const lines = [...output.split("\n"), ...(error ? [error] : [])].filter(Boolean).slice(0, MAX_LINES_PER_TARGET);
    for (let i = 0; i < lines.length; i += 500) {
      await db
        .insertInto("job_logs")
        .values(lines.slice(i, i + 500).map((text, j) => ({ target_id: target.id, seq: i + j, ts: now, stream: "stdout", text: text.slice(0, MAX_LINE) })))
        .onConflict((oc) => oc.columns(["target_id", "seq"]).doNothing())
        .execute();
    }
    await db.updateTable("job_targets").set({ log_lines: lines.length }).where("id", "=", target.id).execute();
  }
  await db
    .updateTable("job_targets")
    .set({ status: ok ? "succeeded" : "failed", error: ok ? null : error, finished_at: now, started_at: target.started_at ?? now, phase: "done", updated_at: now })
    .where("id", "=", target.id)
    .execute();
}

const AGENT_RESTART_TIMEOUT_MS = 10 * 60_000;

async function logLine(db: Kysely<DB>, targetId: string, text: string) {
  const t = await db.selectFrom("job_targets").select("log_lines").where("id", "=", targetId).executeTakeFirstOrThrow();
  await db.insertInto("job_logs").values({ target_id: targetId, seq: t.log_lines, ts: Date.now(), stream: "agent", text }).onConflict((oc) => oc.columns(["target_id", "seq"]).doNothing()).execute();
  await db.updateTable("job_targets").set({ log_lines: t.log_lines + 1 }).where("id", "=", targetId).execute();
}

/**
 * Called on every report: an agent.update target succeeds when the server
 * reports the new version, and fails if the agent rolled itself back.
 */
export async function confirmAgentUpdates(db: Kysely<DB>, serverId: string, version: string, info: AgentInfo | undefined) {
  const open = await db
    .selectFrom("job_targets")
    .innerJoin("jobs", "jobs.id", "job_targets.job_id")
    .select(["job_targets.id", "job_targets.started_at", "jobs.args"])
    .where("job_targets.server_id", "=", serverId)
    .where("jobs.kind", "=", "agent.update")
    .where("job_targets.status", "in", ["queued", "running"])
    .execute();
  const now = Date.now();
  for (const t of open) {
    const want = (JSON.parse(t.args) as { version?: string }).version;
    if (!want) continue;
    if (version === want) {
      await logLine(db, t.id, `Agent reported in running ${version}`);
      await db.updateTable("job_targets").set({ status: "succeeded", phase: "done", finished_at: now, updated_at: now, error: null, started_at: t.started_at ?? now }).where("id", "=", t.id).execute();
    } else if (info?.last_update?.status === "rolled_back" && info.last_update.to === want) {
      const why = `Rolled back to ${version}: ${info.last_update.detail ?? "the new version didn't come up"}`;
      await logLine(db, t.id, why);
      await db.updateTable("job_targets").set({ status: "failed", phase: "done", finished_at: now, updated_at: now, error: why }).where("id", "=", t.id).execute();
    }
  }
}

export type AgentUpdatePlan = { serverId: string; server: string; reason?: string };

/** Queue agent.update on servers ("outdated" = every server behind the shipped version). */
export async function createAgentUpdateJob(db: Kysely<DB>, user: { id: string; name: string }, serverIds: string[] | "outdated") {
  const release = agentRelease();
  if (!release?.version) throw badRequest("This dashboard has no agent release with a version to hand out. Build one with `make release VERSION=x.y.z` (or rebuild the Docker image).");
  let q = db.selectFrom("servers").select(["id", "hostname", "display_name", "arch", "agent_version", "agent_info", "last_seen_at"]);
  if (serverIds !== "outdated") q = q.where("id", "in", serverIds.length ? serverIds : ["-"]);
  const servers = await q.execute();
  const busy = new Set(
    (await db.selectFrom("job_targets").innerJoin("jobs", "jobs.id", "job_targets.job_id").select("job_targets.server_id").where("jobs.kind", "=", "agent.update").where("job_targets.status", "in", ["queued", "running"]).execute()).map((r) => r.server_id),
  );

  const queue: { s: (typeof servers)[number]; file: NonNullable<(typeof release.files)[AgentArch]> }[] = [];
  const skipped: AgentUpdatePlan[] = [];
  for (const s of servers) {
    const name = s.display_name || s.hostname;
    const info = s.agent_info ? (JSON.parse(s.agent_info) as AgentInfo) : undefined;
    const cmp = compareVersions(s.agent_version, release.version);
    const reason =
      busy.has(s.id) ? "an agent update is already in progress"
      : s.agent_version === release.version ? "already up to date"
      : serverIds === "outdated" && cmp === 1 ? "running a newer version than the dashboard ships"
      : !info ? "this agent predates self-update; re-run the installer once"
      : !info.actions.agent_update ? "self-update is disabled in this server's agent config (actions.agent_update)"
      : !info.self_update ? "the agent isn't running under systemd or OpenRC, so it can't restart itself"
      : !release.files[s.arch as AgentArch] ? `no ${s.arch || "unknown"} build in the release`
      : undefined;
    if (reason) skipped.push({ serverId: s.id, server: name, reason });
    else queue.push({ s, file: release.files[s.arch as AgentArch]! });
  }
  if (!queue.length) {
    throw badRequest(skipped.length ? `Nothing to update: ${skipped.map((x) => `${x.server} (${x.reason})`).join("; ")}` : "No servers selected");
  }

  const now = Date.now();
  const jobId = newId("job");
  await db
    .insertInto("jobs")
    .values({ id: jobId, kind: "agent.update", label: `Update agent to ${release.version}`, trigger: "manual", args: JSON.stringify({ version: release.version }), created_by: user.id, created_by_name: user.name, created_at: now })
    .execute();
  for (const { s, file } of queue) {
    const cmd = validateCommand("agent.update", { version: release.version, path: file.path, sha256: file.sha256 });
    const commandId = await queueCommand(db, { serverId: s.id, type: cmd.type, args: cmd.args, label: cmd.label, user });
    await db
      .insertInto("job_targets")
      .values({ id: newId("jt"), job_id: jobId, server_id: s.id, command_id: commandId, run_id: null, status: "queued", phase: "", total: 0, installed: "[]", log_lines: 0, started_at: null, finished_at: null, error: null, updated_at: now })
      .execute();
  }
  await audit(db, user, "agent.update", `${queue.length} server(s)`, `to ${release.version}`);
  return { jobId, queued: queue.length, skipped };
}

/** Expire targets whose command was never picked up, and runs that went silent. */
export async function expireTargets(db: Kysely<DB>, now = Date.now()) {
  await db
    .updateTable("job_targets")
    .set({ status: "failed", error: "The agent didn't report the new version within 10 minutes of restarting", finished_at: now, updated_at: now })
    .where("status", "=", "running")
    .where("phase", "=", "restarting")
    .where("updated_at", "<", now - AGENT_RESTART_TIMEOUT_MS)
    .execute();
  const expired = await db.selectFrom("commands").select("id").where("status", "=", "expired").where("type", "in", ["updates.apply", "agent.update"]).execute();
  if (expired.length) {
    await db
      .updateTable("job_targets")
      .set({ status: "expired", error: "The agent didn't pick up the job in time (server offline?)", finished_at: now, updated_at: now })
      .where("status", "=", "queued")
      .where("command_id", "in", expired.map((c) => c.id))
      .execute();
  }
  await db
    .updateTable("job_targets")
    .set({ status: "failed", error: "Lost contact with the agent during the run", finished_at: now, updated_at: now })
    .where("status", "=", "running")
    .where("updated_at", "<", now - LOST_AFTER_MS)
    .execute();
}

// ----------------------------------------------------------------- queries

export type JobStatus = "queued" | "running" | "succeeded" | "failed" | "partial" | "skipped";

export function jobStatus(statuses: JobTargetStatus[]): JobStatus {
  if (!statuses.length) return "queued";
  if (statuses.some((s) => s === "running")) return "running";
  const done = statuses.filter((s) => FINISHED.includes(s));
  if (done.length < statuses.length) return done.length ? "running" : "queued";
  if (statuses.every((s) => s === "succeeded")) return "succeeded";
  if (statuses.every((s) => s === "skipped")) return "skipped";
  if (statuses.some((s) => s === "succeeded")) return "partial";
  return "failed";
}

type TargetRow = { id: string; job_id: string; server_id: string; status: JobTargetStatus; phase: string; total: number; installed: string; log_lines: number; started_at: number | null; finished_at: number | null; error: string | null; updated_at: number; hostname: string; display_name: string | null };

function shapeTarget(t: TargetRow) {
  const installed = JSON.parse(t.installed) as Installed[];
  return {
    id: t.id, serverId: t.server_id, server: t.display_name || t.hostname, status: t.status, phase: t.phase, total: t.total,
    installed, done: installed.length, logLines: t.log_lines, startedAt: t.started_at, finishedAt: t.finished_at, error: t.error, updatedAt: t.updated_at,
  };
}

async function targetsFor(db: Kysely<DB>, jobIds: string[]) {
  if (!jobIds.length) return [];
  return db
    .selectFrom("job_targets")
    .innerJoin("servers", "servers.id", "job_targets.server_id")
    .select(["job_targets.id", "job_targets.job_id", "job_targets.server_id", "job_targets.status", "job_targets.phase", "job_targets.total", "job_targets.installed", "job_targets.log_lines", "job_targets.started_at", "job_targets.finished_at", "job_targets.error", "job_targets.updated_at", "servers.hostname", "servers.display_name"])
    .where("job_targets.job_id", "in", jobIds)
    .execute() as Promise<TargetRow[]>;
}

function shapeJob(j: DB["jobs"], targets: ReturnType<typeof shapeTarget>[]) {
  const started = targets.map((t) => t.startedAt).filter((x): x is number => !!x);
  const finished = targets.map((t) => t.finishedAt).filter((x): x is number => !!x);
  const status = jobStatus(targets.map((t) => t.status));
  return {
    id: j.id, kind: j.kind, label: j.label, trigger: j.trigger, args: JSON.parse(j.args) as { packages?: string[]; security_only?: boolean },
    createdBy: j.created_by_name, createdAt: j.created_at, status,
    startedAt: started.length ? Math.min(...started) : null,
    finishedAt: status === "running" || status === "queued" || finished.length < targets.length ? null : Math.max(...finished),
    servers: { total: targets.length, succeeded: targets.filter((t) => t.status === "succeeded").length, failed: targets.filter((t) => t.status === "failed" || t.status === "expired").length, running: targets.filter((t) => t.status === "running").length },
    packages: { installed: targets.reduce((a, t) => a + t.done, 0), total: targets.reduce((a, t) => a + Math.max(t.total, t.done), 0) },
  };
}

export async function jobsList(db: Kysely<DB>, limit = 50) {
  const jobs = await db.selectFrom("jobs").selectAll().orderBy("created_at", "desc").limit(limit).execute();
  const targets = (await targetsFor(db, jobs.map((j) => j.id))).map((t) => ({ ...shapeTarget(t), jobId: t.job_id }));
  return jobs.map((j) => ({ ...shapeJob(j, targets.filter((t) => t.jobId === j.id)), serverNames: targets.filter((t) => t.jobId === j.id).map((t) => t.server) }));
}

export async function jobDetail(db: Kysely<DB>, id: string) {
  const job = await db.selectFrom("jobs").selectAll().where("id", "=", id).executeTakeFirst();
  if (!job) return null;
  const targets = (await targetsFor(db, [id])).map(shapeTarget).sort((a, b) => a.server.localeCompare(b.server));
  return { ...shapeJob(job, targets), targets };
}

export async function jobLogs(db: Kysely<DB>, jobId: string, targetId: string, after: number, limit = 2000) {
  const target = await db.selectFrom("job_targets").select(["id", "status"]).where("id", "=", targetId).where("job_id", "=", jobId).executeTakeFirst();
  if (!target) return null;
  const lines = await db
    .selectFrom("job_logs")
    .select(["seq", "ts", "stream", "text"])
    .where("target_id", "=", targetId)
    .where("seq", ">", after)
    .orderBy("seq")
    .limit(Math.min(limit, 5000))
    .execute();
  return { lines, finished: FINISHED.includes(target.status) };
}
