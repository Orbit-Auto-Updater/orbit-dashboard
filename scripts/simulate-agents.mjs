#!/usr/bin/env node
/**
 * Development tool: simulates a small fleet of Linux servers talking the real
 * agent protocol, so the dashboard can be explored without real hosts.
 *
 *   node scripts/simulate-agents.mjs --server http://localhost:3000 --token ldt_… [--interval 10]
 *
 * Package versions are real, outdated releases so the CVE scanner finds real
 * advisories on OSV.dev. Commands (restart, install updates, reboot…) are
 * applied to the simulated state and reported back like the Go agent would.
 */
import fs from "node:fs";
import zlib from "node:zlib";

const arg = (name, def) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : def;
};
const SERVER = arg("server", process.env.LINUX_DASH_SERVER ?? "http://localhost:3000").replace(/\/$/, "");
const TOKEN = arg("token", process.env.LINUX_DASH_TOKEN);
const INTERVAL = Number(arg("interval", "10")) * 1000;
const STATE = arg("state", ".simulated-agents.json");
if (!TOKEN) {
  console.error("usage: simulate-agents.mjs --server URL --token ENROLL_TOKEN");
  process.exit(2);
}

const GB = 1024 ** 3;
const iso = (t = Date.now()) => new Date(t).toISOString();
const walk = (v, base, vol, lo = 0, hi = 100) => Math.min(hi, Math.max(lo, v + (base - v) * 0.15 + (Math.random() - 0.5) * 2 * vol));

const pkg = (name, current, available, security, source, advisory) => ({ name, current, available, security, source, advisory, arch: "amd64" });

const HOSTS = [
  {
    hostname: "web-prod-01", os_name: "Ubuntu 24.04 LTS", os_id: "ubuntu", os_version: "24.04", kernel: "6.8.0-41-generic", cores: 8, mem: 16, manager: "apt", ip: "10.0.1.11",
    cpu: 35, memPct: 58, disks: [["/", 80, 54], ["/var/lib/docker", 200, 61]], allowReboot: true,
    containers: [["nginx-edge", "nginx:1.27-alpine", "running"], ["frontend", "ghcr.io/acme/frontend:4.12.0", "running"], ["api-gateway", "ghcr.io/acme/gateway:2.3.1", "restarting"]],
    pm2: [["storefront-ssr", "deploy", "online"]], units: [["nginx.service", "active"], ["docker.service", "active"]],
    packages: [
      pkg("openssh-server", "1:9.6p1-3ubuntu13", "1:9.6p1-3ubuntu13.5", true, "openssh"),
      pkg("openssh-client", "1:9.6p1-3ubuntu13", "1:9.6p1-3ubuntu13.5", true, "openssh"),
      pkg("curl", "8.5.0-2ubuntu10.1", "8.5.0-2ubuntu10.4", true, "curl"),
      pkg("libcurl4t64", "8.5.0-2ubuntu10.1", "8.5.0-2ubuntu10.4", true, "curl"),
      pkg("tzdata", "2024a-2ubuntu1", "2024a-3ubuntu1.1", false, "tzdata"),
    ],
  },
  {
    hostname: "db-prod-01", os_name: "Debian GNU/Linux 12 (bookworm)", os_id: "debian", os_version: "12", kernel: "6.1.0-21-amd64", cores: 16, mem: 64, manager: "apt", ip: "10.0.3.31",
    cpu: 28, memPct: 79, disks: [["/", 50, 41], ["/var/lib/postgresql", 500, 94]], allowReboot: false,
    containers: [], pm2: [], units: [["postgresql@16-main.service", "active"], ["fail2ban.service", "failed"]],
    packages: [
      pkg("libssl3", "3.0.11-1~deb12u2", "3.0.15-1~deb12u1", true, "openssl"),
      pkg("openssl", "3.0.11-1~deb12u2", "3.0.15-1~deb12u1", true, "openssl"),
      pkg("libexpat1", "2.5.0-1", "2.5.0-1+deb12u1", true, "expat"),
      pkg("postgresql-16", "16.3-1.pgdg120+1", "16.4-1.pgdg120+1", false, "postgresql-16"),
    ],
  },
  {
    hostname: "worker-prod-01", os_name: "Rocky Linux 9.4 (Blue Onyx)", os_id: "rocky", os_version: "9.4", kernel: "5.14.0-427.13.1.el9_4.x86_64", cores: 8, mem: 32, manager: "dnf", ip: "10.0.4.41",
    cpu: 64, memPct: 47, disks: [["/", 100, 33]], allowReboot: true,
    containers: [["queue-worker", "ghcr.io/acme/worker:3.0.2", "running"]],
    pm2: [["webhooks", "deploy", "errored"], ["image-resizer", "deploy", "online"]], units: [["podman.service", "active"]],
    packages: [
      pkg("openssl", "1:3.0.7-25.el9_3", "1:3.0.7-27.el9", true, "openssl", "RLSA-2024:2447"),
      pkg("openssl-libs", "1:3.0.7-25.el9_3", "1:3.0.7-27.el9", true, "openssl", "RLSA-2024:2447"),
      pkg("kernel-core", "5.14.0-427.13.1.el9_4", "5.14.0-427.42.1.el9_4", true, "kernel"),
    ],
  },
  {
    hostname: "cache-01", os_name: "Alpine Linux v3.20", os_id: "alpine", os_version: "3.20.1", kernel: "6.6.32-0-lts", cores: 4, mem: 8, manager: "apk", ip: "10.0.5.51",
    cpu: 12, memPct: 66, disks: [["/", 20, 21]], allowReboot: true,
    containers: [["redis", "redis:7.4-alpine", "running"]], pm2: [], units: [],
    packages: [
      pkg("libcrypto3", "3.3.1-r0", "3.3.2-r0", false, "openssl"),
      pkg("libssl3", "3.3.1-r0", "3.3.2-r0", false, "openssl"),
      pkg("busybox", "1.36.1-r29", "1.36.1-r31", false, "busybox"),
    ],
  },
  {
    hostname: "dev-sandbox", os_name: "Ubuntu 24.04 LTS", os_id: "ubuntu", os_version: "24.04", kernel: "6.8.0-41-generic", cores: 4, mem: 8, manager: "apt", ip: "10.2.0.42",
    cpu: 8, memPct: 30, disks: [["/", 40, 45]], allowReboot: true, goesOffline: 3, // stops reporting after 3 reports
    containers: [], pm2: [], units: [], packages: [],
  },
];

let saved = {};
try {
  saved = JSON.parse(fs.readFileSync(STATE, "utf8"));
} catch {}

async function post(path, body, creds) {
  const res = await fetch(SERVER + path, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Content-Encoding": "gzip", "User-Agent": "linux-dash-agent/sim", "X-Agent-Protocol": "1", ...(creds ? { "X-Agent-ID": creds.agent_id, Authorization: `Bearer ${creds.secret}` } : {}) },
    body: zlib.gzipSync(JSON.stringify(body)),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${path}: ${res.status} ${text}`);
  return text ? JSON.parse(text) : {};
}

class Host {
  constructor(h) {
    Object.assign(this, h);
    this.boot = Date.now() - (2 + Math.random() * 40) * 86400_000;
    this.rx = 1e6 * (2 + Math.random() * 20);
    this.tx = this.rx / 2;
    this.containers = h.containers.map(([name, image, state]) => ({ name, image, state, restarts: state === "restarting" ? 14 : 0 }));
    this.pm2 = h.pm2.map(([name, user, status]) => ({ name, user, status, restarts: status === "errored" ? 27 : 1 }));
    this.units = h.units.map(([name, state]) => ({ name, state }));
    this.results = [];
    this.lastRun = undefined;
    this.reboot = false;
    this.reports = 0;
    this.downUntil = 0;
  }

  report() {
    this.cpu = walk(this.cpu, this.base ?? (this.base = this.cpu), 6);
    this.memPct = walk(this.memPct, this.memBase ?? (this.memBase = this.memPct), 1.2);
    this.rx = walk(this.rx, this.rxBase ?? (this.rxBase = this.rx), this.rx * 0.2, 0, 1e10);
    this.tx = walk(this.tx, this.txBase ?? (this.txBase = this.tx), this.tx * 0.2, 0, 1e10);
    const memTotal = this.mem * GB;
    const rep = {
      agent_version: "0.1.0-sim",
      sent_at: iso(),
      host: { hostname: this.hostname, os_name: this.os_name, os_id: this.os_id, os_version: this.os_version, kernel: this.kernel, arch: "amd64", cpu_cores: this.cores, mem_total_bytes: memTotal, boot_time: iso(this.boot), ips: [this.ip], package_manager: this.manager },
      metrics: {
        collected_at: iso(), cpu_percent: +this.cpu.toFixed(1), cpu_iowait_percent: +(this.cpu / 20).toFixed(1), load1: +((this.cpu / 100) * this.cores).toFixed(2), load5: 0, load15: 0,
        mem_total_bytes: memTotal, mem_used_bytes: (memTotal * this.memPct) / 100, mem_available_bytes: (memTotal * (100 - this.memPct)) / 100, mem_percent: +this.memPct.toFixed(1),
        swap_total_bytes: 2 * GB, swap_used_bytes: this.memPct > 85 ? 0.6 * GB : 0, uptime_seconds: (Date.now() - this.boot) / 1000,
        disks: this.disks.map(([mount, size, pct]) => ({ mount, device: "/dev/nvme0n1p" + (mount.length % 4), fs_type: "ext4", total_bytes: size * GB, used_bytes: (size * GB * pct) / 100, free_bytes: (size * GB * (100 - pct)) / 100, used_percent: pct, inodes_used_percent: 12 })),
        net: [{ name: "eth0", rx_bytes_per_sec: Math.round(this.rx), tx_bytes_per_sec: Math.round(this.tx), rx_bytes_total: 0, tx_bytes_total: 0, rx_errors: 0, tx_errors: 0 }],
      },
      apps: {
        collected_at: iso(),
        docker: this.containers.length ? { containers: this.containers.map((c, i) => ({ id: `c0ffee${i}${this.ip.replace(/\D/g, "")}`.slice(0, 12), name: c.name, image: c.image, state: c.state, status: c.state === "running" ? "Up 2 days" : c.state === "restarting" ? "Restarting (137) 4 seconds ago" : "Exited (0) 1 minute ago", created_at: iso(this.boot), restart_count: c.restarts, exit_code: c.state === "restarting" ? 137 : 0, oom_killed: c.state === "restarting", cpu_percent: c.state === "running" ? +(Math.random() * 20).toFixed(1) : 0, mem_bytes: c.state === "running" ? (100 + Math.random() * 400) * 1024 ** 2 : 0, mem_limit_bytes: memTotal, ports: c.name === "nginx-edge" ? ["80->80/tcp", "443->443/tcp"] : [] })) } : undefined,
        pm2: this.pm2.length ? { processes: this.pm2.map((p, i) => ({ user: p.user, pm_id: i, name: p.name, pid: p.status === "online" ? 4000 + i : 0, status: p.status, mode: "cluster", cpu_percent: p.status === "online" ? Math.round(Math.random() * 30) : 0, mem_bytes: p.status === "online" ? 300 * 1024 ** 2 : 0, restarts: p.restarts, unstable_restarts: 0, started_at: p.status === "online" ? iso(this.boot + 3600_000) : undefined })) } : undefined,
        systemd: this.units.length ? { units: this.units.map((u) => ({ name: u.name, active_state: u.state, sub_state: u.state === "active" ? "running" : u.state === "failed" ? "failed" : "dead", unit_file_state: "enabled", watched: true })) } : undefined,
      },
      updates: { manager: this.manager, checked_at: iso(Date.now() - 3600_000), packages: this.packages, reboot_required: this.reboot, running: false, last_run: this.lastRun },
      logs: Math.random() < 0.3 ? [{ time: iso(), priority: 3, unit: this.units.find((u) => u.state === "failed")?.name ?? "kernel", message: ["Failed to start service: exit-code", "EXT4-fs warning: ext4_dx_add_entry: Directory index full!", "Out of memory: Killed process 3121 (node)"][Math.floor(Math.random() * 3)] }] : [],
      results: this.results.splice(0),
    };
    if (!rep.apps.docker && !rep.apps.pm2 && !rep.apps.systemd) delete rep.apps;
    return rep;
  }

  execute(cmd) {
    const done = (ok, output, error) => this.results.push({ id: cmd.id, type: cmd.type, ok, output, error, started_at: iso(), finished_at: iso() });
    const [kind, action] = cmd.type.split(".");
    const a = cmd.args ?? {};
    if (kind === "docker") {
      const c = this.containers.find((x) => x.name === a.id);
      if (!c) return done(false, "", `No such container: ${a.id}`);
      c.state = action === "stop" ? "exited" : "running";
      if (action !== "stop") c.restarts = 0;
      return done(true, `container ${a.id}: ${action} ok`);
    }
    if (kind === "pm2") {
      const p = this.pm2.find((x) => x.name === a.name);
      if (!p) return done(false, "", `[PM2][ERROR] Process or Namespace ${a.name} not found`);
      p.status = action === "stop" ? "stopped" : "online";
      return done(true, `pm2 ${action} ${a.name} ok`);
    }
    if (kind === "systemd") {
      const u = this.units.find((x) => x.name === a.unit);
      if (!u) return done(false, "", `unit ${a.unit} is not in systemd.watch and systemd.control_any is false`);
      u.state = action === "stop" ? "inactive" : "active";
      return done(true, `systemctl ${action} ${a.unit} queued`);
    }
    if (cmd.type === "updates.check") return done(true, `${this.packages.length} updates available (${this.packages.filter((p) => p.security).length} security)`);
    if (cmd.type === "updates.apply") {
      const chosen = this.packages.filter((p) => (a.packages?.length ? a.packages.includes(p.name) : a.security_only ? p.security : true));
      this.packages = this.packages.filter((p) => !chosen.includes(p));
      if (chosen.some((p) => p.name.startsWith("kernel") || p.name.startsWith("linux-image") || p.source === "openssl")) this.reboot = true;
      this.lastRun = { trigger: "command", started_at: iso(Date.now() - 40_000), finished_at: iso(), status: "success", packages: chosen.map((p) => p.name) };
      return done(true, `upgraded ${chosen.length} package(s)\n${chosen.map((p) => `Setting up ${p.name} (${p.available}) ...`).join("\n")}`);
    }
    if (cmd.type === "host.reboot") {
      if (!this.allowReboot) return done(false, "", "action disabled in agent config: actions.reboot");
      done(true, `reboot scheduled in ${a.delay_minutes ?? 1} minute(s)`);
      this.downUntil = Date.now() + 75_000;
      this.reboot = false;
      this.boot = this.downUntil;
      return;
    }
    if (cmd.type === "agent.refresh") return done(true, "collection triggered");
    done(false, "", `unknown command type "${cmd.type}"`);
  }
}

const hosts = HOSTS.map((h) => new Host(h));

async function tick(h) {
  if (h.goesOffline && h.reports >= h.goesOffline) return;
  if (Date.now() < h.downUntil) return;
  try {
    if (!saved[h.hostname]) {
      saved[h.hostname] = await post("/api/agent/v1/enroll", { token: TOKEN, agent_version: "0.1.0-sim", host: h.report().host });
      fs.writeFileSync(STATE, JSON.stringify(saved, null, 2));
      console.log(`enrolled ${h.hostname} as ${saved[h.hostname].agent_id}`);
    }
    const resp = await post("/api/agent/v1/report", h.report(), saved[h.hostname]);
    h.reports++;
    h.seen ??= new Set();
    for (const cmd of resp.commands ?? []) {
      if (h.seen.has(cmd.id)) continue;
      h.seen.add(cmd.id);
      console.log(`${h.hostname}: ${cmd.type} ${JSON.stringify(cmd.args ?? {})}`);
      h.execute(cmd);
    }
  } catch (err) {
    console.warn(`${h.hostname}: ${err.message}`);
    if (/401/.test(err.message)) delete saved[h.hostname];
  }
}

console.log(`simulating ${hosts.length} servers against ${SERVER} every ${INTERVAL / 1000}s (Ctrl-C to stop)`);
for (const h of hosts) tick(h);
setInterval(() => hosts.forEach(tick), INTERVAL);
// Deliver command results quickly, like the real agent does after finishing work.
setInterval(() => hosts.filter((h) => h.results.length).forEach(tick), 1500);
