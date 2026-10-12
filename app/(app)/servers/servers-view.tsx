"use client";

import {
  ArrowDown,
  ArrowUp,
  Copy,
  Cpu,
  History,
  LayoutGrid,
  List,
  Network,
  PackageCheck,
  Pencil,
  Plus,
  Power,
  RefreshCw,
  ScrollText,
  Search,
  ShieldAlert,
  Terminal,
  Trash2,
  TriangleAlert,
  X,
} from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { LiveChart, RingGauge, Sparkline } from "@/components/charts";
import { Modal, useConfirm, useToast } from "@/components/providers";
import { Badge, Button, Card, CardHeader, cn, EmptyNote, EnvBadge, Field, IconButton, inputClass, MeterRow, PageHeader, Segmented, StatusBadge, StatusDot, Table, type Env } from "@/components/ui";
import { ago, api, bytes, dateTime, duration, rate, useApi, useCommand, useMe, useStartUpdateJob } from "@/lib/client";
import type { ServerSummary } from "@/lib/server/queries";

type Filter = "all" | ServerSummary["status"];

export function ServersView() {
  const { can } = useMe();
  const params = useSearchParams();
  const router = useRouter();
  const [filter, setFilter] = useState<Filter>("all");
  const [env, setEnv] = useState<"all" | Env>("all");
  const [query, setQuery] = useState("");
  const [view, setView] = useState<"grid" | "list">("grid");
  const selected = params.get("open");
  const { data, error } = useApi<{ servers: ServerSummary[] }>("/api/servers", { interval: 5000 });
  const servers = useMemo(() => data?.servers ?? [], [data]);

  const open = (id: string | null) => router.replace(id ? `/servers?open=${id}` : "/servers", { scroll: false });

  const counts = useMemo(() => {
    const c: Record<string, number> = { all: servers.length };
    for (const s of servers) c[s.status] = (c[s.status] ?? 0) + 1;
    return c;
  }, [servers]);

  const visible = servers.filter(
    (s) => (filter === "all" || s.status === filter) && (env === "all" || s.environment === env) && (query === "" || `${s.name} ${s.hostname} ${s.ips.join(" ")} ${s.os}`.toLowerCase().includes(query.toLowerCase())),
  );

  return (
    <div className="space-y-6">
      <PageHeader
        title="Servers"
        description="Real-time resource usage and health for every enrolled host."
        actions={
          can("servers.manage") && (
            <Link href="/agents#enrolment">
              <Button variant="primary" icon={Plus}>
                Add server
              </Button>
            </Link>
          )
        }
      />

      <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
        <Segmented
          value={filter}
          onChange={setFilter}
          size="sm"
          options={[
            { value: "all", label: "All", count: counts.all },
            { value: "critical", label: "Critical", count: counts.critical ?? 0 },
            { value: "warning", label: "Warning", count: counts.warning ?? 0 },
            { value: "healthy", label: "Healthy", count: counts.healthy ?? 0 },
            { value: "offline", label: "Offline", count: counts.offline ?? 0 },
          ]}
        />
        <div className="flex flex-1 items-center gap-2">
          <div className="relative min-w-0 flex-1 lg:ml-auto lg:max-w-xs">
            <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-subtle" />
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Filter by name, IP or OS" className={cn(inputClass, "h-8 pl-9 text-xs")} />
          </div>
          <select value={env} onChange={(e) => setEnv(e.target.value as typeof env)} className={cn(inputClass, "h-8 !w-auto shrink-0 text-xs")} aria-label="Environment">
            <option value="all">All environments</option>
            <option value="production">Production</option>
            <option value="staging">Staging</option>
            <option value="development">Development</option>
          </select>
          <div className="flex rounded-lg border border-line bg-inset p-0.5">
            <IconButton icon={LayoutGrid} label="Grid view" onClick={() => setView("grid")} className={cn("size-7", view === "grid" && "bg-primary-soft text-primary-fg")} />
            <IconButton icon={List} label="List view" onClick={() => setView("list")} className={cn("size-7", view === "list" && "bg-primary-soft text-primary-fg")} />
          </div>
        </div>
      </div>

      {error && !data ? (
        <EmptyNote>Couldn&apos;t load servers: {error.message}</EmptyNote>
      ) : !data ? (
        <p className="text-sm text-muted">Loading…</p>
      ) : servers.length === 0 ? (
        <EmptyNote>
          No servers enrolled yet. {can("servers.manage") ? <Link className="text-primary-fg underline" href="/agents#enrolment">Create an enrolment token</Link> : "Ask an admin to add one"} and run the installer on a server.
        </EmptyNote>
      ) : visible.length === 0 ? (
        <EmptyNote>No servers match these filters.</EmptyNote>
      ) : view === "grid" ? (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
          {visible.map((s) => (
            <ServerCard key={s.id} server={s} onOpen={() => open(s.id)} />
          ))}
        </div>
      ) : (
        <Card>
          <Table>
            <thead>
              <tr>
                <th>Host</th>
                <th>Environment</th>
                <th>OS</th>
                <th className="w-32">CPU</th>
                <th className="w-32">Memory</th>
                <th className="w-32">Disk</th>
                <th>Uptime</th>
                <th>Updates</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((s) => (
                <tr key={s.id} onClick={() => open(s.id)} className="cursor-pointer">
                  <td>
                    <div className="flex items-center gap-2.5">
                      <StatusDot status={s.status} />
                      <div>
                        <p className="font-medium">{s.name}</p>
                        <p className="font-mono text-[11px] text-subtle">{s.ips[0] ?? s.hostname}</p>
                      </div>
                    </div>
                  </td>
                  <td>
                    <EnvBadge env={s.environment as Env} />
                  </td>
                  <td className="text-muted">{s.os}</td>
                  <td>{s.status === "offline" ? "—" : <MeterRow label="" value={s.cpu} warn={70} />}</td>
                  <td>{s.status === "offline" ? "—" : <MeterRow label="" value={s.mem} warn={80} crit={92} />}</td>
                  <td>
                    <MeterRow label="" value={s.disk} warn={80} />
                  </td>
                  <td className="tabular text-muted">{duration(s.uptimeSeconds)}</td>
                  <td>{s.security > 0 ? <Badge tone="warn" icon={ShieldAlert}>{s.updates}</Badge> : <span className="text-muted">{s.updates}</span>}</td>
                </tr>
              ))}
            </tbody>
          </Table>
        </Card>
      )}

      {selected && <ServerDrawer id={selected} onClose={() => open(null)} />}
    </div>
  );
}

function ServerCard({ server: s, onOpen }: { server: ServerSummary; onOpen: () => void }) {
  const offline = s.status === "offline";
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), onOpen())}
      className={cn(
        "glass group relative flex cursor-pointer flex-col overflow-hidden p-4 text-left transition-all hover:-translate-y-0.5 hover:bg-glass-hover focus-visible:ring-2 focus-visible:ring-[var(--primary-ring)] focus-visible:outline-none",
        s.status === "critical" && "border-crit/40",
        s.status === "warning" && "border-warn/30",
        offline && "opacity-70",
      )}
    >
      {(s.status === "critical" || s.status === "warning") && <span className={cn("absolute inset-x-0 top-0 h-0.5", s.status === "critical" ? "bg-crit" : "bg-warn")} />}
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <StatusDot status={s.status} />
            <p className="truncate font-medium">{s.name}</p>
          </div>
          <p className="mt-0.5 truncate font-mono text-[11px] text-subtle">
            {s.ips[0] ?? s.hostname} · {s.os}
          </p>
        </div>
        <EnvBadge env={s.environment as Env} />
      </div>

      {s.issue && (
        <p className={cn("mt-3 flex items-center gap-1.5 rounded-md px-2 py-1 text-[11px] font-medium", s.status === "critical" ? "bg-crit/10 text-crit" : offline ? "bg-fg/5 text-muted" : "bg-warn/10 text-warn")}>
          <TriangleAlert className="size-3 shrink-0" />
          <span className="truncate">{s.issue}</span>
        </p>
      )}

      <div className="mt-4">
        <div className="mb-1 flex items-baseline justify-between text-xs">
          <span className="text-subtle">CPU · {s.cores} cores</span>
          <span className={cn("tabular font-semibold", s.cpu >= 80 ? "text-warn" : "text-fg")}>{offline ? "—" : `${Math.round(s.cpu)}%`}</span>
        </div>
        <Sparkline data={s.spark.length > 1 ? s.spark : [0, 0, 0]} color={s.cpu >= 80 ? "var(--warn)" : "var(--s1)"} height={36} />
      </div>

      <div className="mt-3 space-y-2">
        <MeterRow label="Mem" value={s.mem} warn={80} crit={92} />
        <MeterRow label="Disk" value={s.disk} warn={80} crit={90} />
      </div>

      <div className="mt-4 flex items-center justify-between border-t border-line pt-3 text-[11px] text-subtle">
        <span className="tabular flex items-center gap-2">
          <span className="flex items-center gap-0.5">
            <ArrowDown className="size-3" />
            {rate(s.rxBps)}
          </span>
          <span className="flex items-center gap-0.5">
            <ArrowUp className="size-3" />
            {rate(s.txBps)}
          </span>
        </span>
        <span className="flex items-center gap-2">
          {s.vulns.critical + s.vulns.high > 0 && (
            <Badge tone="crit" icon={ShieldAlert}>
              {s.vulns.critical + s.vulns.high} CVE
            </Badge>
          )}
          {s.security > 0 && <Badge tone="warn">{s.security} sec</Badge>}
          <span className="tabular">{offline ? `seen ${ago(s.lastSeen)}` : `up ${duration(s.uptimeSeconds)}`}</span>
        </span>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ drawer

type Detail = {
  server: ServerSummary;
  series: { cpu: number[]; mem: number[]; rx: number[]; tx: number[]; stepMs: number; hasData: boolean };
  disks: { mount: string; device: string; fs_type: string; total_bytes: number; used_percent: number; free_bytes: number; inodes_used_percent: number }[];
  net: { name: string; rx_bytes_per_sec: number; tx_bytes_per_sec: number; rx_errors: number; tx_errors: number }[];
  swap: { total: number; used: number } | null;
  updates: { manager: string; checked_at: string; error?: string; packages: { name: string; current?: string; available: string; security: boolean; advisory?: string }[] | null; reboot_required: boolean; running: boolean } | null;
  alerts: { id: string; severity: string; title: string; detail: string; last_seen: number }[];
  logs: { id: string; ts: number; priority: number; unit: string; message: string }[];
  commands: { id: string; label: string; status: string; created_by_name: string | null; created_at: number; finished_at: number | null; error: string | null; output: string | null }[];
  runs: { id: string; trigger: string; started_at: number; status: string; packages: string[]; error: string | null }[];
  vulnerabilities: { id: string; vuln_id: string; package: string; severity: string; score: number | null; fixed_version: string | null; status: string; summary: string; url: string }[];
  cveScannedAt: number | null;
  cveError: string | null;
};

type Range = "live" | "1h" | "24h" | "7d";

function ServerDrawer({ id, onClose }: { id: string; onClose: () => void }) {
  const { can } = useMe();
  const confirm = useConfirm();
  const run = useCommand();
  const { toast } = useToast();
  const startJob = useStartUpdateJob();
  const [range, setRange] = useState<Range>("live");
  const [tab, setTab] = useState<"overview" | "updates" | "logs" | "activity">("overview");
  const [editing, setEditing] = useState(false);
  const [sshOpen, setSshOpen] = useState(false);
  const { data, error, reload } = useApi<Detail>(`/api/servers/${id}?range=${range}`, { interval: range === "live" ? 5000 : 60_000 });

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const s = data?.server;
  const offline = s?.status === "offline";
  const cmd = (type: string, args: Record<string, unknown> = {}) => run(id, type, args, reload);

  async function reboot() {
    if (!s) return;
    if (await confirm({ title: `Reboot ${s.name}?`, body: <>The agent schedules a reboot one minute after it receives this. Services on this host will be unavailable until it comes back.</>, confirmLabel: "Reboot", danger: true })) cmd("host.reboot", { delay_minutes: 1 });
  }

  async function installUpdates(securityOnly: boolean) {
    if (!s) return;
    const n = securityOnly ? s.security : s.updates;
    if (await confirm({ title: `Install ${n} ${securityOnly ? "security " : ""}update${n === 1 ? "" : "s"} on ${s.name}?`, body: "Packages are upgraded non-interactively with the host's package manager. Pre-flight checks skip the run if disk space is low.", confirmLabel: "Install" }))
      startJob({ serverIds: [id], securityOnly });
  }

  async function remove() {
    if (!s) return;
    if (await confirm({ title: `Remove ${s.name}?`, body: "Its history is deleted and the agent's credentials stop working. Uninstall the agent from the host as well.", confirmLabel: "Remove server", danger: true })) {
      try {
        await api(`/api/servers/${id}`, { method: "DELETE" });
        toast({ title: `${s.name} removed`, tone: "success" });
        onClose();
      } catch (err) {
        toast({ title: "Couldn't remove server", body: (err as Error).message, tone: "error" });
      }
    }
  }

  return (
    <div className="fixed inset-0 z-50" role="dialog" aria-modal="true" aria-label={s ? `${s.name} details` : "Server details"}>
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} />
      <div className="glass glass-strong absolute inset-y-0 right-0 flex w-full max-w-3xl flex-col rounded-none sm:rounded-l-2xl">
        {!data ? (
          <div className="flex items-center justify-between p-5">
            <p className="text-sm text-muted">{error ? `Couldn't load: ${error.message}` : "Loading…"}</p>
            <IconButton icon={X} label="Close" onClick={onClose} />
          </div>
        ) : (
          <>
            <div className="flex items-start gap-3 border-b border-line p-5">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="text-lg font-semibold">{s!.name}</h2>
                  <StatusBadge status={s!.status} />
                  <EnvBadge env={s!.environment as Env} />
                  {s!.rebootRequired && <Badge tone="info">Reboot required</Badge>}
                </div>
                <p className="mt-1 font-mono text-xs text-subtle">
                  {[s!.ips.join(", "), s!.os, `kernel ${s!.kernel}`, s!.arch, `agent ${s!.agentVersion}`].filter(Boolean).join(" · ")}
                </p>
                <p className="mt-0.5 text-[11px] text-subtle">
                  Last report {ago(s!.lastSeen)} · enrolled {dateTime(s!.enrolledAt)}
                </p>
              </div>
              <IconButton icon={X} label="Close" onClick={onClose} />
            </div>

            <div className="flex flex-wrap gap-2 border-b border-line px-5 py-3">
              <Button size="sm" icon={Terminal} onClick={() => setSshOpen(true)}>
                SSH
              </Button>
              <Button size="sm" icon={RefreshCw} onClick={() => cmd("agent.refresh")} disabled={offline}>
                Refresh
              </Button>
              {can("updates.run") && (
                <Button size="sm" icon={PackageCheck} onClick={() => cmd("updates.check")} disabled={offline}>
                  Check updates
                </Button>
              )}
              {can("updates.run") && s!.updates > 0 && (
                <Button size="sm" variant="primary" icon={PackageCheck} onClick={() => installUpdates(s!.security > 0)} disabled={offline || s!.agentActions?.updates === false} title={s!.agentActions?.updates === false ? "Installing updates is disabled in this server's agent config" : undefined}>
                  Install {s!.security > 0 ? `${s!.security} security` : s!.updates} update{(s!.security || s!.updates) === 1 ? "" : "s"}
                </Button>
              )}
              {can("servers.reboot") && (
                <Button size="sm" variant="danger" icon={Power} onClick={reboot} disabled={offline || s!.agentActions?.reboot === false} title={s!.agentActions?.reboot === false ? "Reboots are disabled in this server's agent config (actions.reboot)" : undefined}>
                  Reboot
                </Button>
              )}
              {can("servers.manage") && (
                <span className="ml-auto flex gap-1">
                  <IconButton icon={Pencil} label="Edit server" onClick={() => setEditing(true)} />
                  <IconButton icon={Trash2} label="Remove server" onClick={remove} />
                </span>
              )}
            </div>

            <div className="border-b border-line px-5 pt-3 pb-3">
              <Segmented
                size="sm"
                value={tab}
                onChange={setTab}
                options={[
                  { value: "overview", label: "Overview" },
                  { value: "updates", label: "Updates & CVEs", count: s!.updates + data.vulnerabilities.filter((v) => v.status === "open").length },
                  { value: "logs", label: "Logs", count: data.logs.length },
                  { value: "activity", label: "Activity" },
                ]}
              />
            </div>

            <div className="flex-1 space-y-5 overflow-y-auto p-5 scrollbar-thin">
              {data.alerts.filter((a) => a.severity !== "info").map((a) => (
                <div key={a.id} className={cn("flex items-center gap-2 rounded-lg border p-3 text-sm", a.severity === "critical" ? "border-crit/30 bg-crit/10 text-crit" : "border-warn/30 bg-warn/10 text-warn")}>
                  <TriangleAlert className="size-4 shrink-0" />
                  <span>
                    <b>{a.title}</b>: {a.detail}
                  </span>
                </div>
              ))}

              {tab === "overview" && <OverviewTab data={data} range={range} setRange={setRange} />}
              {tab === "updates" && <UpdatesTab data={data} serverId={id} onInstall={installUpdates} />}
              {tab === "logs" && <LogsTab logs={data.logs} />}
              {tab === "activity" && <ActivityTab data={data} />}
            </div>
          </>
        )}
      </div>
      {editing && s && <EditServer server={s} onClose={() => setEditing(false)} onSaved={reload} />}
      {sshOpen && s && <SshDialog server={s} onClose={() => setSshOpen(false)} />}
    </div>
  );
}

function OverviewTab({ data, range, setRange }: { data: Detail; range: Range; setRange: (r: Range) => void }) {
  const s = data.server;
  const offline = s.status === "offline";
  return (
    <>
      <div className="grid grid-cols-3 gap-2 rounded-xl border border-line bg-inset py-4">
        <RingGauge value={offline ? 0 : s.cpu} label="CPU" sub={`${s.cores} cores · load ${s.load1.toFixed(2)}`} warn={70} />
        <RingGauge value={offline ? 0 : s.mem} label="Memory" sub={bytes(s.memTotal, 0)} warn={80} crit={92} />
        <RingGauge value={s.disk} label="Disk" sub="fullest mount" warn={80} crit={90} />
      </div>

      <Card className="p-4">
        <CardHeader icon={Cpu} title="CPU & memory" action={<Segmented size="sm" value={range} onChange={setRange} options={[{ value: "live", label: "Live" }, { value: "1h", label: "1h" }, { value: "24h", label: "24h" }, { value: "7d", label: "7d" }]} />} />
        <LiveChart height={180} max={100} stepMs={data.series.stepMs} animate={range === "live"} series={[{ key: "cpu", label: "CPU", color: "var(--s1)", data: data.series.cpu }, { key: "mem", label: "Memory", color: "var(--s2)", data: data.series.mem }]} />
      </Card>

      <Card className="p-4">
        <CardHeader icon={Network} title="Network" subtitle={data.net.map((n) => n.name).join(", ") || "no interfaces"} />
        <LiveChart height={150} area={false} stepMs={data.series.stepMs} animate={range === "live"} format={(v) => rate(v)} minMax={1024 * 1024} series={[{ key: "rx", label: "Inbound", color: "var(--s1)", data: data.series.rx }, { key: "tx", label: "Outbound", color: "var(--s3)", data: data.series.tx }]} />
        {data.net.some((n) => n.rx_errors + n.tx_errors > 0) && (
          <p className="mt-3 text-xs text-warn">
            Interface errors: {data.net.filter((n) => n.rx_errors + n.tx_errors > 0).map((n) => `${n.name} rx ${n.rx_errors} / tx ${n.tx_errors}`).join(", ")}
          </p>
        )}
      </Card>

      <Card className="p-4">
        <CardHeader title="Filesystems" subtitle={data.swap?.total ? `Swap ${bytes(data.swap.used)} of ${bytes(data.swap.total)} used` : undefined} />
        {data.disks.length === 0 ? (
          <EmptyNote>No filesystems reported.</EmptyNote>
        ) : (
          <div className="space-y-3">
            {data.disks.map((d) => (
              <div key={d.mount}>
                <div className="mb-1 flex justify-between gap-3 text-xs">
                  <span className="truncate font-mono">
                    {d.mount} <span className="text-subtle">({d.device}, {d.fs_type})</span>
                  </span>
                  <span className="shrink-0 text-subtle">
                    {bytes(d.free_bytes)} free of {bytes(d.total_bytes)}
                    {d.inodes_used_percent > 80 && <span className="ml-1 text-warn">· inodes {d.inodes_used_percent.toFixed(0)}%</span>}
                  </span>
                </div>
                <MeterRow label="" value={d.used_percent} warn={80} crit={90} />
              </div>
            ))}
          </div>
        )}
      </Card>
    </>
  );
}

function UpdatesTab({ data, serverId, onInstall }: { data: Detail; serverId: string; onInstall: (securityOnly: boolean) => void }) {
  const { can } = useMe();
  const startJob = useStartUpdateJob();
  const u = data.updates;
  const pkgs = u?.packages ?? [];
  const sevTone = (sev: string) => (sev === "critical" ? "crit" : sev === "high" ? "warn" : sev === "medium" ? "info" : "neutral");
  return (
    <>
      <Card className="p-4">
        <CardHeader
          icon={PackageCheck}
          title={`${pkgs.length} pending update${pkgs.length === 1 ? "" : "s"}`}
          subtitle={u ? `${u.manager} · checked ${ago(u.checked_at)}${u.running ? " · update running now" : ""}` : "Not checked yet"}
          action={
            can("updates.run") && pkgs.length > 0 ? (
              <div className="flex gap-2">
                {pkgs.some((p) => p.security) && (
                  <Button size="sm" onClick={() => onInstall(true)}>
                    Security only
                  </Button>
                )}
                <Button size="sm" variant="primary" onClick={() => onInstall(false)}>
                  Install all
                </Button>
              </div>
            ) : undefined
          }
        />
        {u?.error && <p className="mb-3 rounded-lg bg-crit/10 p-2 text-xs text-crit">{u.error}</p>}
        {pkgs.length === 0 ? (
          <EmptyNote>Everything is up to date.</EmptyNote>
        ) : (
          <ul className="divide-y divide-line text-xs">
            {pkgs.map((p) => (
              <li key={p.name} className="flex items-center gap-3 py-2">
                <span className="min-w-0 flex-1">
                  <span className="font-mono font-medium">{p.name}</span>
                  <span className="ml-2 font-mono text-subtle">
                    {p.current ?? "?"} → <span className="text-fg">{p.available}</span>
                  </span>
                </span>
                {p.security && <Badge tone="warn" icon={ShieldAlert}>{p.advisory ?? "security"}</Badge>}
                {can("updates.run") && (
                  <Button size="sm" variant="ghost" onClick={() => startJob({ serverIds: [serverId], packages: [p.name] })}>
                    Install
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card className="p-4">
        <CardHeader icon={ShieldAlert} title="Vulnerabilities" subtitle={data.cveError ?? (data.cveScannedAt ? `Scanned ${ago(data.cveScannedAt)}` : "Not scanned yet")} action={<Link href="/vulnerabilities" className="text-xs font-medium text-primary-fg hover:underline">All</Link>} />
        {data.vulnerabilities.length === 0 ? (
          <EmptyNote>No known vulnerabilities in pending packages.</EmptyNote>
        ) : (
          <ul className="divide-y divide-line text-xs">
            {data.vulnerabilities.map((v) => (
              <li key={v.id} className={cn("flex items-start gap-3 py-2", v.status === "ignored" && "opacity-60")}>
                <Badge tone={sevTone(v.severity)}>{v.score ? v.score.toFixed(1) : v.severity}</Badge>
                <div className="min-w-0 flex-1">
                  <p>
                    {v.url ? (
                      <a href={v.url} target="_blank" rel="noreferrer" className="font-mono font-medium hover:underline">
                        {v.vuln_id}
                      </a>
                    ) : (
                      <span className="font-mono font-medium">{v.vuln_id}</span>
                    )}{" "}
                    <span className="text-muted">in {v.package}</span>
                    {v.status === "ignored" && <span className="ml-1 text-subtle">(ignored)</span>}
                  </p>
                  <p className="truncate text-subtle">{v.summary}</p>
                </div>
                {v.fixed_version && <span className="shrink-0 font-mono text-subtle">fix {v.fixed_version}</span>}
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card className="p-4">
        <CardHeader icon={History} title="Update runs" />
        {data.runs.length === 0 ? (
          <EmptyNote>No update runs recorded yet.</EmptyNote>
        ) : (
          <ul className="space-y-2 text-xs">
            {data.runs.map((r) => (
              <li key={r.id} className="flex items-start gap-3">
                <StatusBadge status={r.status === "skipped" ? "paused" : r.status} label={r.status} />
                <div className="min-w-0 flex-1">
                  <p>
                    {dateTime(r.started_at)} · {r.trigger} · {r.packages.length} package{r.packages.length === 1 ? "" : "s"}
                  </p>
                  {r.error && <p className="text-crit">{r.error}</p>}
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </>
  );
}

const PRIO = ["emerg", "alert", "crit", "err", "warn", "notice", "info", "debug"];

function LogsTab({ logs }: { logs: Detail["logs"] }) {
  return (
    <Card className="p-4">
      <CardHeader icon={ScrollText} title="Recent journal errors" subtitle="Reported by the agent from journald" />
      {logs.length === 0 ? (
        <EmptyNote>No errors logged recently.</EmptyNote>
      ) : (
        <div className="max-h-[60vh] space-y-1 overflow-y-auto rounded-lg bg-inset p-3 font-mono text-[11px] leading-relaxed scrollbar-thin">
          {logs.map((l) => (
            <p key={l.id} className="flex gap-2">
              <span className="shrink-0 text-subtle">{new Date(l.ts).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", second: "2-digit" })}</span>
              <span className={cn("w-10 shrink-0 font-semibold uppercase", l.priority <= 3 ? "text-crit" : l.priority === 4 ? "text-warn" : "text-info")}>{PRIO[l.priority] ?? l.priority}</span>
              <span className="shrink-0 text-muted">{l.unit}:</span>
              <span className="min-w-0 break-words">{l.message}</span>
            </p>
          ))}
        </div>
      )}
    </Card>
  );
}

function ActivityTab({ data }: { data: Detail }) {
  return (
    <Card className="p-4">
      <CardHeader icon={History} title="Actions on this server" />
      {data.commands.length === 0 ? (
        <EmptyNote>No actions yet.</EmptyNote>
      ) : (
        <ul className="divide-y divide-line text-xs">
          {data.commands.map((c) => (
            <li key={c.id} className="py-2">
              <div className="flex items-center gap-2">
                <StatusBadge status={c.status === "succeeded" ? "success" : c.status === "delivered" ? "launching" : c.status === "pending" ? "inactive" : "failed"} label={c.status} />
                <span className="font-medium">{c.label}</span>
                <span className="ml-auto text-subtle">
                  {c.created_by_name} · {ago(c.created_at)}
                </span>
              </div>
              {(c.error || c.output) && <pre className="mt-1 max-h-32 overflow-auto rounded bg-inset p-2 font-mono text-[11px] whitespace-pre-wrap text-muted scrollbar-thin">{c.error || c.output}</pre>}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function EditServer({ server, onClose, onSaved }: { server: ServerSummary; onClose: () => void; onSaved: () => void }) {
  const { toast } = useToast();
  const [f, setF] = useState({ displayName: server.name === server.hostname ? "" : server.name, environment: server.environment, sshUser: server.sshUser ?? "" });
  const [busy, setBusy] = useState(false);
  return (
    <Modal title={`Edit ${server.hostname}`} onClose={onClose} icon={Pencil}>
      <form
        className="space-y-4"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          try {
            await api(`/api/servers/${server.id}`, { method: "PATCH", body: f });
            toast({ title: "Server updated", tone: "success" });
            onSaved();
            onClose();
          } catch (err) {
            toast({ title: "Couldn't save", body: (err as Error).message, tone: "error" });
            setBusy(false);
          }
        }}
      >
        <Field label="Display name" hint={`Leave empty to use the hostname (${server.hostname})`}>
          <input className={inputClass} value={f.displayName} onChange={(e) => setF({ ...f, displayName: e.target.value })} />
        </Field>
        <Field label="Environment" hint="Decides which auto-update policy applies.">
          <select className={inputClass} value={f.environment} onChange={(e) => setF({ ...f, environment: e.target.value })}>
            <option value="production">Production</option>
            <option value="staging">Staging</option>
            <option value="development">Development</option>
          </select>
        </Field>
        <Field label="SSH user" hint="Used for the SSH shortcut.">
          <input className={cn(inputClass, "font-mono")} placeholder="e.g. ubuntu" value={f.sshUser} onChange={(e) => setF({ ...f, sshUser: e.target.value })} />
        </Field>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" type="submit" disabled={busy}>
            Save
          </Button>
        </div>
      </form>
    </Modal>
  );
}

function SshDialog({ server, onClose }: { server: ServerSummary; onClose: () => void }) {
  const { toast } = useToast();
  const [ip, setIp] = useState(server.ips[0] ?? server.hostname);
  const user = server.sshUser || "root";
  const command = `ssh ${user}@${ip}`;
  return (
    <Modal title={`SSH to ${server.name}`} onClose={onClose} icon={Terminal}>
      <p className="text-sm text-muted">Connect from your own terminal with your usual SSH keys. The dashboard never holds SSH credentials.</p>
      {server.ips.length > 1 && (
        <Field label="Address">
          <select className={cn(inputClass, "mt-3 font-mono")} value={ip} onChange={(e) => setIp(e.target.value)}>
            {[...server.ips, server.hostname].map((a) => (
              <option key={a}>{a}</option>
            ))}
          </select>
        </Field>
      )}
      <div className="mt-4 flex items-center gap-2 rounded-lg border border-line bg-inset p-3">
        <code className="min-w-0 flex-1 truncate font-mono text-sm">{command}</code>
        <Button size="sm" variant="ghost" icon={Copy} onClick={() => navigator.clipboard?.writeText(command).then(() => toast({ title: "Copied", tone: "success" }))}>
          Copy
        </Button>
      </div>
      <div className="mt-4 flex justify-between gap-2">
        <p className="text-xs text-subtle">{server.sshUser ? "" : "Set an SSH user with Edit to change root."}</p>
        <a href={`ssh://${user}@${ip}`}>
          <Button variant="primary" icon={Terminal}>
            Open in terminal app
          </Button>
        </a>
      </div>
    </Modal>
  );
}
