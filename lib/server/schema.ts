/**
 * Table types for Kysely. Timestamps are epoch milliseconds, booleans are
 * 0/1 integers and structured values are JSON text, so the same queries run
 * on SQLite and PostgreSQL.
 */
export type Bool = 0 | 1;

export interface SettingsTable { key: string; value: string }

export interface UsersTable {
  id: string;
  name: string;
  email: string;
  password_hash: string | null;
  role_id: string;
  status: "active" | "invited" | "suspended";
  invite_token_hash: string | null;
  invite_expires_at: number | null;
  timezone: string | null;
  created_at: number;
  last_active_at: number | null;
}

export interface SessionsTable {
  id: string; // sha256 of the cookie token
  user_id: string;
  created_at: number;
  expires_at: number;
  last_seen_at: number;
  ip: string | null;
  user_agent: string | null;
}

export interface RolesTable { id: string; name: string; description: string; builtin: Bool }
export interface RolePermissionsTable { role_id: string; permission: string }

export interface EnrollmentTokensTable {
  id: string;
  label: string;
  token_hash: string;
  token_prefix: string;
  environment: string;
  created_by: string | null;
  created_at: number;
  expires_at: number | null;
  max_uses: number | null;
  uses: number;
  revoked: Bool;
  last_used_at: number | null;
}

export interface ServersTable {
  id: string;
  secret_hash: string;
  hostname: string;
  display_name: string | null;
  environment: string;
  os_name: string;
  os_id: string;
  os_version: string;
  kernel: string;
  arch: string;
  cpu_cores: number;
  mem_total: number;
  ips: string; // JSON string[]
  package_manager: string;
  agent_version: string;
  ssh_user: string | null;
  enrolled_at: number;
  last_seen_at: number;
  boot_time: number | null;
  metrics: string | null; // latest protocol Metrics JSON
  apps: string | null; // latest protocol Apps JSON
  apps_at: number | null;
  updates: string | null; // latest protocol UpdateStatus JSON
  updates_at: number | null;
  agent_info: string | null; // protocol AgentInfo JSON
  packages_hash: string | null; // to detect when a CVE rescan is needed
  cve_scanned_at: number | null;
  cve_error: string | null;
}

export interface MetricsTable {
  server_id: string;
  ts: number;
  cpu: number;
  iowait: number;
  mem_pct: number;
  swap_pct: number;
  load1: number;
  rx_bps: number;
  tx_bps: number;
  disk_pct: number;
}

export interface LogsTable {
  id: string;
  server_id: string;
  ts: number;
  priority: number;
  unit: string;
  message: string;
}

export type CommandStatus = "pending" | "delivered" | "succeeded" | "failed" | "expired" | "cancelled";

export interface CommandsTable {
  id: string;
  server_id: string;
  type: string;
  args: string; // JSON
  status: CommandStatus;
  label: string;
  created_by: string | null;
  created_by_name: string | null;
  created_at: number;
  expires_at: number;
  delivered_at: number | null;
  finished_at: number | null;
  output: string | null;
  error: string | null;
}

export interface UpdatePoliciesTable {
  id: string;
  name: string;
  environment: string;
  enabled: Bool;
  scope: "security" | "all";
  days: string; // JSON string[]
  start: string; // HH:MM, "" for interval policies
  duration_minutes: number;
  timezone: string;
  interval_hours: number;
  auto_reboot: Bool;
  exclude: string; // JSON string[]
  updated_at: number;
}

export interface UpdateRunsTable {
  id: string;
  server_id: string;
  trigger: string;
  started_at: number;
  finished_at: number;
  status: string;
  packages: string; // JSON string[]
  error: string | null;
  reboot_scheduled: Bool;
}

export type Severity = "critical" | "warning" | "info";

export interface AlertsTable {
  id: string;
  fingerprint: string;
  server_id: string | null;
  severity: Severity;
  source: string;
  title: string;
  detail: string;
  status: "open" | "acknowledged" | "resolved";
  first_seen: number;
  last_seen: number;
  acknowledged_by: string | null;
  acknowledged_at: number | null;
  resolved_at: number | null;
}

export type AlertRuleKind =
  | "cpu" | "memory" | "disk" | "offline" | "container" | "pm2" | "systemd" | "cve" | "update_failed" | "reboot_required";

export interface AlertRulesTable {
  id: string;
  kind: AlertRuleKind;
  name: string;
  threshold: number;
  duration_minutes: number;
  severity: Severity;
  enabled: Bool;
}

export type VulnSeverity = "critical" | "high" | "medium" | "low" | "unknown";

export interface VulnerabilitiesTable {
  id: string;
  server_id: string;
  package: string; // source package (what advisories apply to)
  binaries: string; // comma-separated binary packages from that source
  installed_version: string;
  fixed_version: string | null;
  vuln_id: string;
  aliases: string; // JSON string[]
  severity: VulnSeverity;
  score: number | null;
  summary: string;
  url: string;
  origin: "osv" | "package-manager";
  status: "open" | "ignored" | "fixed";
  first_seen: number;
  last_seen: number;
  ignored_by: string | null;
  ignored_reason: string | null;
}

export type JobTargetStatus = "queued" | "running" | "succeeded" | "failed" | "skipped" | "expired";

export interface JobsTable {
  id: string;
  kind: string; // "updates.apply"
  label: string;
  trigger: "manual" | "schedule";
  args: string; // JSON: { packages?, security_only? }
  created_by: string | null;
  created_by_name: string;
  created_at: number;
}

/** One server's part of a job. */
export interface JobTargetsTable {
  id: string;
  job_id: string;
  server_id: string;
  command_id: string | null; // null for scheduled runs
  run_id: string | null; // agent's run id, known once it starts streaming
  status: JobTargetStatus;
  phase: string;
  total: number;
  installed: string; // JSON [{ name, version, t }]
  log_lines: number;
  started_at: number | null;
  finished_at: number | null;
  error: string | null;
  updated_at: number;
}

export interface JobLogsTable {
  target_id: string;
  seq: number;
  ts: number;
  stream: string;
  text: string;
}

export interface OsvCacheTable { id: string; data: string; fetched_at: number }

export interface AuditLogTable {
  id: string;
  ts: number;
  user_id: string | null;
  user_name: string;
  action: string;
  target: string;
  detail: string;
}

export interface DB {
  settings: SettingsTable;
  users: UsersTable;
  sessions: SessionsTable;
  roles: RolesTable;
  role_permissions: RolePermissionsTable;
  enrollment_tokens: EnrollmentTokensTable;
  servers: ServersTable;
  metrics: MetricsTable;
  logs: LogsTable;
  commands: CommandsTable;
  update_policies: UpdatePoliciesTable;
  update_runs: UpdateRunsTable;
  alerts: AlertsTable;
  alert_rules: AlertRulesTable;
  vulnerabilities: VulnerabilitiesTable;
  osv_cache: OsvCacheTable;
  audit_log: AuditLogTable;
  jobs: JobsTable;
  job_targets: JobTargetsTable;
  job_logs: JobLogsTable;
}
