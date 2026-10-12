/**
 * Schema migrations, applied automatically on first connection (and by the
 * setup wizard). Add new migrations to the end of `migrations`; never edit
 * one that has shipped.
 */
/* eslint-disable @typescript-eslint/no-explicit-any -- migrations must not depend on the current schema types */
import { Kysely, Migrator, sql, type Migration, type MigrationProvider } from "kysely";
import { BUILTIN_ROLES } from "../permissions";

const now = () => Date.now();

const initial: Migration = {
  async up(db: Kysely<any>) {
    const t = (name: string) => db.schema.createTable(name).ifNotExists();
    const idx = (name: string, table: string, cols: string[], unique = false) => {
      let b = db.schema.createIndex(name).ifNotExists().on(table).columns(cols);
      if (unique) b = b.unique();
      return b.execute();
    };

    await t("settings").addColumn("key", "text", (c) => c.primaryKey()).addColumn("value", "text", (c) => c.notNull()).execute();

    await t("roles")
      .addColumn("id", "text", (c) => c.primaryKey())
      .addColumn("name", "text", (c) => c.notNull())
      .addColumn("description", "text", (c) => c.notNull().defaultTo(""))
      .addColumn("builtin", "integer", (c) => c.notNull().defaultTo(0))
      .execute();

    await t("role_permissions")
      .addColumn("role_id", "text", (c) => c.notNull().references("roles.id").onDelete("cascade"))
      .addColumn("permission", "text", (c) => c.notNull())
      .addPrimaryKeyConstraint("role_permissions_pk", ["role_id", "permission"])
      .execute();

    await t("users")
      .addColumn("id", "text", (c) => c.primaryKey())
      .addColumn("name", "text", (c) => c.notNull())
      .addColumn("email", "text", (c) => c.notNull())
      .addColumn("password_hash", "text")
      .addColumn("role_id", "text", (c) => c.notNull().references("roles.id"))
      .addColumn("status", "text", (c) => c.notNull())
      .addColumn("invite_token_hash", "text")
      .addColumn("invite_expires_at", "bigint")
      .addColumn("timezone", "text")
      .addColumn("created_at", "bigint", (c) => c.notNull())
      .addColumn("last_active_at", "bigint")
      .execute();
    await idx("users_email", "users", ["email"], true);
    await idx("users_invite", "users", ["invite_token_hash"]);

    await t("sessions")
      .addColumn("id", "text", (c) => c.primaryKey())
      .addColumn("user_id", "text", (c) => c.notNull().references("users.id").onDelete("cascade"))
      .addColumn("created_at", "bigint", (c) => c.notNull())
      .addColumn("expires_at", "bigint", (c) => c.notNull())
      .addColumn("last_seen_at", "bigint", (c) => c.notNull())
      .addColumn("ip", "text")
      .addColumn("user_agent", "text")
      .execute();
    await idx("sessions_user", "sessions", ["user_id"]);

    await t("enrollment_tokens")
      .addColumn("id", "text", (c) => c.primaryKey())
      .addColumn("label", "text", (c) => c.notNull())
      .addColumn("token_hash", "text", (c) => c.notNull())
      .addColumn("token_prefix", "text", (c) => c.notNull())
      .addColumn("environment", "text", (c) => c.notNull())
      .addColumn("created_by", "text")
      .addColumn("created_at", "bigint", (c) => c.notNull())
      .addColumn("expires_at", "bigint")
      .addColumn("max_uses", "integer")
      .addColumn("uses", "integer", (c) => c.notNull().defaultTo(0))
      .addColumn("revoked", "integer", (c) => c.notNull().defaultTo(0))
      .addColumn("last_used_at", "bigint")
      .execute();
    await idx("enrollment_tokens_hash", "enrollment_tokens", ["token_hash"], true);

    await t("servers")
      .addColumn("id", "text", (c) => c.primaryKey())
      .addColumn("secret_hash", "text", (c) => c.notNull())
      .addColumn("hostname", "text", (c) => c.notNull())
      .addColumn("display_name", "text")
      .addColumn("environment", "text", (c) => c.notNull())
      .addColumn("os_name", "text", (c) => c.notNull().defaultTo(""))
      .addColumn("os_id", "text", (c) => c.notNull().defaultTo(""))
      .addColumn("os_version", "text", (c) => c.notNull().defaultTo(""))
      .addColumn("kernel", "text", (c) => c.notNull().defaultTo(""))
      .addColumn("arch", "text", (c) => c.notNull().defaultTo(""))
      .addColumn("cpu_cores", "integer", (c) => c.notNull().defaultTo(0))
      .addColumn("mem_total", "bigint", (c) => c.notNull().defaultTo(0))
      .addColumn("ips", "text", (c) => c.notNull().defaultTo("[]"))
      .addColumn("package_manager", "text", (c) => c.notNull().defaultTo(""))
      .addColumn("agent_version", "text", (c) => c.notNull().defaultTo(""))
      .addColumn("ssh_user", "text")
      .addColumn("enrolled_at", "bigint", (c) => c.notNull())
      .addColumn("last_seen_at", "bigint", (c) => c.notNull())
      .addColumn("boot_time", "bigint")
      .addColumn("metrics", "text")
      .addColumn("apps", "text")
      .addColumn("apps_at", "bigint")
      .addColumn("updates", "text")
      .addColumn("updates_at", "bigint")
      .addColumn("packages_hash", "text")
      .addColumn("cve_scanned_at", "bigint")
      .addColumn("cve_error", "text")
      .execute();

    await t("metrics")
      .addColumn("server_id", "text", (c) => c.notNull().references("servers.id").onDelete("cascade"))
      .addColumn("ts", "bigint", (c) => c.notNull())
      .addColumn("cpu", "double precision", (c) => c.notNull())
      .addColumn("iowait", "double precision", (c) => c.notNull())
      .addColumn("mem_pct", "double precision", (c) => c.notNull())
      .addColumn("swap_pct", "double precision", (c) => c.notNull())
      .addColumn("load1", "double precision", (c) => c.notNull())
      .addColumn("rx_bps", "double precision", (c) => c.notNull())
      .addColumn("tx_bps", "double precision", (c) => c.notNull())
      .addColumn("disk_pct", "double precision", (c) => c.notNull())
      .execute();
    await idx("metrics_server_ts", "metrics", ["server_id", "ts"]);
    await idx("metrics_ts", "metrics", ["ts"]);

    await t("logs")
      .addColumn("id", "text", (c) => c.primaryKey())
      .addColumn("server_id", "text", (c) => c.notNull().references("servers.id").onDelete("cascade"))
      .addColumn("ts", "bigint", (c) => c.notNull())
      .addColumn("priority", "integer", (c) => c.notNull())
      .addColumn("unit", "text", (c) => c.notNull())
      .addColumn("message", "text", (c) => c.notNull())
      .execute();
    await idx("logs_server_ts", "logs", ["server_id", "ts"]);
    await idx("logs_ts", "logs", ["ts"]);

    await t("commands")
      .addColumn("id", "text", (c) => c.primaryKey())
      .addColumn("server_id", "text", (c) => c.notNull().references("servers.id").onDelete("cascade"))
      .addColumn("type", "text", (c) => c.notNull())
      .addColumn("args", "text", (c) => c.notNull())
      .addColumn("status", "text", (c) => c.notNull())
      .addColumn("label", "text", (c) => c.notNull())
      .addColumn("created_by", "text")
      .addColumn("created_by_name", "text")
      .addColumn("created_at", "bigint", (c) => c.notNull())
      .addColumn("expires_at", "bigint", (c) => c.notNull())
      .addColumn("delivered_at", "bigint")
      .addColumn("finished_at", "bigint")
      .addColumn("output", "text")
      .addColumn("error", "text")
      .execute();
    await idx("commands_server_status", "commands", ["server_id", "status"]);
    await idx("commands_created", "commands", ["created_at"]);

    await t("update_policies")
      .addColumn("id", "text", (c) => c.primaryKey())
      .addColumn("name", "text", (c) => c.notNull())
      .addColumn("environment", "text", (c) => c.notNull())
      .addColumn("enabled", "integer", (c) => c.notNull())
      .addColumn("scope", "text", (c) => c.notNull())
      .addColumn("days", "text", (c) => c.notNull())
      .addColumn("start", "text", (c) => c.notNull())
      .addColumn("duration_minutes", "integer", (c) => c.notNull())
      .addColumn("timezone", "text", (c) => c.notNull())
      .addColumn("interval_hours", "integer", (c) => c.notNull())
      .addColumn("auto_reboot", "integer", (c) => c.notNull())
      .addColumn("exclude", "text", (c) => c.notNull())
      .addColumn("updated_at", "bigint", (c) => c.notNull())
      .execute();
    await idx("update_policies_env", "update_policies", ["environment"], true);

    await t("update_runs")
      .addColumn("id", "text", (c) => c.primaryKey())
      .addColumn("server_id", "text", (c) => c.notNull().references("servers.id").onDelete("cascade"))
      .addColumn("trigger", "text", (c) => c.notNull())
      .addColumn("started_at", "bigint", (c) => c.notNull())
      .addColumn("finished_at", "bigint", (c) => c.notNull())
      .addColumn("status", "text", (c) => c.notNull())
      .addColumn("packages", "text", (c) => c.notNull())
      .addColumn("error", "text")
      .addColumn("reboot_scheduled", "integer", (c) => c.notNull().defaultTo(0))
      .execute();
    await idx("update_runs_server_started", "update_runs", ["server_id", "started_at"], true);

    await t("alerts")
      .addColumn("id", "text", (c) => c.primaryKey())
      .addColumn("fingerprint", "text", (c) => c.notNull())
      .addColumn("server_id", "text", (c) => c.references("servers.id").onDelete("cascade"))
      .addColumn("severity", "text", (c) => c.notNull())
      .addColumn("source", "text", (c) => c.notNull())
      .addColumn("title", "text", (c) => c.notNull())
      .addColumn("detail", "text", (c) => c.notNull())
      .addColumn("status", "text", (c) => c.notNull())
      .addColumn("first_seen", "bigint", (c) => c.notNull())
      .addColumn("last_seen", "bigint", (c) => c.notNull())
      .addColumn("acknowledged_by", "text")
      .addColumn("acknowledged_at", "bigint")
      .addColumn("resolved_at", "bigint")
      .execute();
    await idx("alerts_fingerprint_status", "alerts", ["fingerprint", "status"]);
    await idx("alerts_status_last", "alerts", ["status", "last_seen"]);

    await t("alert_rules")
      .addColumn("id", "text", (c) => c.primaryKey())
      .addColumn("kind", "text", (c) => c.notNull())
      .addColumn("name", "text", (c) => c.notNull())
      .addColumn("threshold", "double precision", (c) => c.notNull())
      .addColumn("duration_minutes", "integer", (c) => c.notNull())
      .addColumn("severity", "text", (c) => c.notNull())
      .addColumn("enabled", "integer", (c) => c.notNull())
      .execute();

    await t("vulnerabilities")
      .addColumn("id", "text", (c) => c.primaryKey())
      .addColumn("server_id", "text", (c) => c.notNull().references("servers.id").onDelete("cascade"))
      .addColumn("package", "text", (c) => c.notNull())
      .addColumn("binaries", "text", (c) => c.notNull())
      .addColumn("installed_version", "text", (c) => c.notNull())
      .addColumn("fixed_version", "text")
      .addColumn("vuln_id", "text", (c) => c.notNull())
      .addColumn("aliases", "text", (c) => c.notNull())
      .addColumn("severity", "text", (c) => c.notNull())
      .addColumn("score", "double precision")
      .addColumn("summary", "text", (c) => c.notNull())
      .addColumn("url", "text", (c) => c.notNull())
      .addColumn("origin", "text", (c) => c.notNull())
      .addColumn("status", "text", (c) => c.notNull())
      .addColumn("first_seen", "bigint", (c) => c.notNull())
      .addColumn("last_seen", "bigint", (c) => c.notNull())
      .addColumn("ignored_by", "text")
      .addColumn("ignored_reason", "text")
      .execute();
    await idx("vulnerabilities_key", "vulnerabilities", ["server_id", "package", "vuln_id"], true);
    await idx("vulnerabilities_status", "vulnerabilities", ["status", "severity"]);

    await t("osv_cache")
      .addColumn("id", "text", (c) => c.primaryKey())
      .addColumn("data", "text", (c) => c.notNull())
      .addColumn("fetched_at", "bigint", (c) => c.notNull())
      .execute();

    await t("audit_log")
      .addColumn("id", "text", (c) => c.primaryKey())
      .addColumn("ts", "bigint", (c) => c.notNull())
      .addColumn("user_id", "text")
      .addColumn("user_name", "text", (c) => c.notNull())
      .addColumn("action", "text", (c) => c.notNull())
      .addColumn("target", "text", (c) => c.notNull())
      .addColumn("detail", "text", (c) => c.notNull())
      .execute();
    await idx("audit_log_ts", "audit_log", ["ts"]);

    // ------------------------------------------------------------- seed data
    for (const r of BUILTIN_ROLES) {
      await db.insertInto("roles").values({ id: r.id, name: r.name, description: r.description, builtin: 1 }).execute();
      await db.insertInto("role_permissions").values(r.permissions.map((p) => ({ role_id: r.id, permission: p }))).execute();
    }

    await db
      .insertInto("alert_rules")
      .values([
        { id: "cpu", kind: "cpu", name: "CPU above threshold", threshold: 85, duration_minutes: 10, severity: "warning", enabled: 1 },
        { id: "memory", kind: "memory", name: "Memory above threshold", threshold: 90, duration_minutes: 5, severity: "warning", enabled: 1 },
        { id: "disk", kind: "disk", name: "Disk usage above threshold", threshold: 90, duration_minutes: 0, severity: "critical", enabled: 1 },
        { id: "offline", kind: "offline", name: "Agent stopped reporting", threshold: 0, duration_minutes: 3, severity: "critical", enabled: 1 },
        { id: "container", kind: "container", name: "Container restarting or unhealthy", threshold: 0, duration_minutes: 0, severity: "critical", enabled: 1 },
        { id: "pm2", kind: "pm2", name: "PM2 process errored", threshold: 0, duration_minutes: 0, severity: "warning", enabled: 1 },
        { id: "systemd", kind: "systemd", name: "systemd unit failed", threshold: 0, duration_minutes: 0, severity: "warning", enabled: 1 },
        { id: "cve", kind: "cve", name: "Vulnerable packages (CVSS ≥ threshold)", threshold: 7, duration_minutes: 0, severity: "critical", enabled: 1 },
        { id: "update_failed", kind: "update_failed", name: "Update run failed", threshold: 0, duration_minutes: 0, severity: "warning", enabled: 1 },
        { id: "reboot_required", kind: "reboot_required", name: "Reboot required after updates", threshold: 0, duration_minutes: 0, severity: "info", enabled: 1 },
      ])
      .execute();

    const policy = (environment: string, name: string) => ({
      id: environment, name, environment, enabled: 0, scope: "security", days: JSON.stringify(["sun"]), start: "02:00",
      duration_minutes: 120, timezone: "UTC", interval_hours: 0, auto_reboot: 0, exclude: "[]", updated_at: now(),
    });
    await db
      .insertInto("update_policies")
      .values([policy("production", "Production"), policy("staging", "Staging"), policy("development", "Development")])
      .execute();

    await db
      .insertInto("settings")
      .values([
        { key: "org_name", value: "My organisation" },
        { key: "public_url", value: "" },
        { key: "metrics_retention_days", value: "7" },
        { key: "logs_retention_days", value: "30" },
        { key: "cve_scan_enabled", value: "1" },
        { key: "cve_scan_interval_hours", value: "12" },
        { key: "webhook_url", value: "" },
        { key: "webhook_min_severity", value: "critical" },
      ])
      .execute();
  },
};

const jobs: Migration = {
  async up(db: Kysely<any>) {
    await db.schema
      .createTable("jobs")
      .ifNotExists()
      .addColumn("id", "text", (c) => c.primaryKey())
      .addColumn("kind", "text", (c) => c.notNull())
      .addColumn("label", "text", (c) => c.notNull())
      .addColumn("trigger", "text", (c) => c.notNull())
      .addColumn("args", "text", (c) => c.notNull())
      .addColumn("created_by", "text")
      .addColumn("created_by_name", "text", (c) => c.notNull())
      .addColumn("created_at", "bigint", (c) => c.notNull())
      .execute();
    await db.schema.createIndex("jobs_created").ifNotExists().on("jobs").column("created_at").execute();

    await db.schema
      .createTable("job_targets")
      .ifNotExists()
      .addColumn("id", "text", (c) => c.primaryKey())
      .addColumn("job_id", "text", (c) => c.notNull().references("jobs.id").onDelete("cascade"))
      .addColumn("server_id", "text", (c) => c.notNull().references("servers.id").onDelete("cascade"))
      .addColumn("command_id", "text")
      .addColumn("run_id", "text")
      .addColumn("status", "text", (c) => c.notNull())
      .addColumn("phase", "text", (c) => c.notNull().defaultTo(""))
      .addColumn("total", "integer", (c) => c.notNull().defaultTo(0))
      .addColumn("installed", "text", (c) => c.notNull().defaultTo("[]"))
      .addColumn("log_lines", "integer", (c) => c.notNull().defaultTo(0))
      .addColumn("started_at", "bigint")
      .addColumn("finished_at", "bigint")
      .addColumn("error", "text")
      .addColumn("updated_at", "bigint", (c) => c.notNull())
      .execute();
    await db.schema.createIndex("job_targets_job").ifNotExists().on("job_targets").column("job_id").execute();
    await db.schema.createIndex("job_targets_command").ifNotExists().on("job_targets").column("command_id").execute();
    await db.schema.createIndex("job_targets_run").ifNotExists().on("job_targets").columns(["server_id", "run_id"]).execute();
    await db.schema.createIndex("job_targets_status").ifNotExists().on("job_targets").column("status").execute();

    await db.schema
      .createTable("job_logs")
      .ifNotExists()
      .addColumn("target_id", "text", (c) => c.notNull().references("job_targets.id").onDelete("cascade"))
      .addColumn("seq", "integer", (c) => c.notNull())
      .addColumn("ts", "bigint", (c) => c.notNull())
      .addColumn("stream", "text", (c) => c.notNull())
      .addColumn("text", "text", (c) => c.notNull())
      .addPrimaryKeyConstraint("job_logs_pk", ["target_id", "seq"])
      .execute();
  },
};

const agents: Migration = {
  async up(db: Kysely<any>) {
    // What each agent reports about its own config (actions, monitors, version support).
    await db.schema.alterTable("servers").addColumn("agent_info", "text").execute();
    // The OSV cache stored full advisories (hundreds of MB); entries are now
    // slimmed on write, so drop the old ones and let scans refill it.
    await db.deleteFrom("osv_cache").execute();
  },
};

export const migrations: Record<string, Migration> = {
  "2026_10_12_001_initial": initial,
  "2026_10_13_002_jobs": jobs,
  "2026_10_13_003_agents": agents,
};

class StaticProvider implements MigrationProvider {
  async getMigrations() {
    return migrations;
  }
}

/** Apply pending migrations; returns the names applied. */
export async function migrateToLatest(db: Kysely<any>): Promise<string[]> {
  const migrator = new Migrator({ db, provider: new StaticProvider() });
  const { error, results } = await migrator.migrateToLatest();
  if (error) {
    const failed = results?.find((r) => r.status === "Error");
    throw new Error(`database migration ${failed?.migrationName ?? ""} failed: ${(error as Error).message ?? error}`);
  }
  return (results ?? []).filter((r) => r.status === "Success").map((r) => r.migrationName);
}

export async function listTables(db: Kysely<any>): Promise<string[]> {
  const tables = await db.introspection.getTables();
  return tables.map((t) => t.name).filter((n) => !n.startsWith("kysely_")).sort();
}

export { sql };
