/** TypeScript mirror of linux-dash-agent/internal/protocol (v1). */

export type HostInfo = {
  hostname: string;
  os_name: string;
  os_id: string;
  os_version: string;
  kernel: string;
  arch: string;
  cpu_cores: number;
  mem_total_bytes: number;
  boot_time?: string;
  ips?: string[];
  package_manager?: string;
};

export type Disk = { mount: string; device: string; fs_type: string; total_bytes: number; used_bytes: number; free_bytes: number; used_percent: number; inodes_used_percent: number };
export type NetIface = { name: string; rx_bytes_per_sec: number; tx_bytes_per_sec: number; rx_bytes_total: number; tx_bytes_total: number; rx_errors: number; tx_errors: number };

export type Metrics = {
  collected_at: string;
  cpu_percent: number;
  cpu_iowait_percent: number;
  load1: number;
  load5: number;
  load15: number;
  mem_total_bytes: number;
  mem_used_bytes: number;
  mem_available_bytes: number;
  mem_percent: number;
  swap_total_bytes: number;
  swap_used_bytes: number;
  uptime_seconds: number;
  disks: Disk[] | null;
  net: NetIface[] | null;
  errors?: string[];
};

export type Container = {
  id: string; name: string; image: string; state: string; status: string; health?: string; created_at: string; started_at?: string;
  restart_count: number; exit_code: number; oom_killed?: boolean; cpu_percent: number; mem_bytes: number; mem_limit_bytes: number; ports?: string[];
};
export type PM2Process = { user: string; pm_id: number; name: string; pid: number; status: string; mode: string; cpu_percent: number; mem_bytes: number; restarts: number; unstable_restarts: number; started_at?: string };
export type SystemdUnit = { name: string; description?: string; active_state: string; sub_state: string; unit_file_state?: string; main_pid?: number; restarts?: number; watched: boolean };

export type Apps = {
  collected_at: string;
  docker?: { error?: string; containers: Container[] | null };
  pm2?: { errors?: string[]; processes: PM2Process[] | null };
  systemd?: { error?: string; units: SystemdUnit[] | null };
};

export type LogEntry = { time: string; priority: number; unit?: string; message: string };

export type Package = { name: string; arch?: string; current?: string; available: string; repo?: string; security: boolean; advisory?: string; source?: string };

export type UpdateRun = {
  trigger: string; started_at: string; finished_at: string; status: string; packages?: string[]; error?: string; reboot_scheduled?: boolean; output_tail?: string;
};

export type UpdateStatus = {
  manager: string; checked_at: string; error?: string; packages: Package[] | null; reboot_required: boolean; running: boolean; last_run?: UpdateRun;
};

export type CommandResult = { id: string; type: string; ok: boolean; error?: string; output?: string; started_at: string; finished_at: string };

export type Report = {
  agent_version: string;
  sent_at: string;
  host: HostInfo;
  metrics?: Metrics;
  apps?: Apps;
  updates?: UpdateStatus;
  logs?: LogEntry[];
  results?: CommandResult[];
  agent?: AgentInfo;
};

export type AgentInfo = {
  version: string;
  report_interval_seconds: number;
  actions: Record<string, boolean>;
  features: Record<string, boolean>;
  package_manager?: string;
  self_update: boolean;
  supervisor?: string;
  config_path?: string;
  last_update?: { from: string; to: string; status: "confirmed" | "rolled_back"; detail?: string; finished_at: string };
};

export type Policy = {
  enabled: boolean;
  scope: "security" | "all";
  window?: { days?: string[]; start: string; duration_minutes: number; timezone?: string };
  interval_hours?: number;
  auto_reboot: boolean;
  exclude?: string[];
};

export type Command = { id: string; type: string; args?: unknown; issued_at?: string };

export type LogLine = { t: string; s: string; text: string };
export type InstalledPackage = { name: string; version?: string; t: string };

/** Live progress of a long-running job (see PROTOCOL.md). */
export type Progress = {
  run_id: string;
  command_id?: string;
  kind: string;
  trigger: string;
  started_at: string;
  phase?: string;
  total?: number;
  seq: number;
  lines?: LogLine[];
  installed?: InstalledPackage[];
  done?: boolean;
  status?: string;
  error?: string;
};

export type ReportResponse = { commands?: Command[]; policy?: Policy };

export const COMMAND_TYPES = [
  "agent.refresh",
  "agent.update",
  "updates.check",
  "updates.apply",
  "host.reboot",
  "docker.start", "docker.stop", "docker.restart",
  "pm2.start", "pm2.stop", "pm2.restart",
  "systemd.start", "systemd.stop", "systemd.restart",
] as const;
export type CommandType = (typeof COMMAND_TYPES)[number];
