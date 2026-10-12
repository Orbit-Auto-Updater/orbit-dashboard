"use client";

import {
  Activity,
  ArrowRight,
  Boxes,
  CalendarClock,
  CircleAlert,
  Cpu,
  History,
  MemoryStick,
  Network,
  PackageCheck,
  Plus,
  RefreshCw,
  Server,
  ShieldAlert,
  TriangleAlert,
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";
import { useState, type ReactNode } from "react";
import { LiveChart } from "@/components/charts";
import { useToast } from "@/components/providers";
import { Badge, Button, Card, CardHeader, cn, EmptyNote, MeterRow, PageHeader, Segmented, StatusBadge, StatusDot, Table } from "@/components/ui";
import { ago, api, bytes, rate, useApi, useMe } from "@/lib/client";
import type { ServerSummary } from "@/lib/server/queries";

type Range = "live" | "1h" | "24h" | "7d";
type Overview = {
  fleet: { total: number; online: number; pendingUpdates: number; securityUpdates: number; rebootRequired: number; openAlerts: number; criticalAlerts: number; vulnCritical: number; vulnHigh: number; memUsed: number; memTotal: number };
  series: { cpu: number[]; mem: number[]; rx: number[]; tx: number[]; stepMs: number; hasData: boolean };
  attention: ServerSummary[];
  alerts: { id: string; severity: string; title: string; detail: string; last_seen: number; hostname: string | null }[];
  critical: { id: string; title: string; hostname: string | null }[];
  apps: Record<"docker" | "pm2" | "systemd", { total: number; running: number; failing: number }>;
  policies: { id: string; name: string; enabled: boolean; scope: string; days: string[]; start: string; timezone: string; intervalHours: number; servers: number }[];
  activity: { id: string; user_name: string; action: string; target: string; detail: string; ts: number }[];
};

function StatTile({ label, value, sub, icon: Icon, tone = "neutral", href }: { label: string; value: ReactNode; sub: ReactNode; icon: LucideIcon; tone?: "neutral" | "warn" | "crit"; href?: string }) {
  const body = (
    <div className={cn("glass group relative h-full overflow-hidden p-4 transition-colors", href && "hover:bg-glass-hover", tone === "crit" && "border-crit/35", tone === "warn" && "border-warn/30")}>
      {tone !== "neutral" && <span className={cn("absolute inset-x-0 top-0 h-0.5", tone === "crit" ? "bg-crit" : "bg-warn")} />}
      <div className="flex items-center justify-between">
        <p className="text-xs font-medium text-muted">{label}</p>
        <Icon className={cn("size-4", tone === "crit" ? "text-crit" : tone === "warn" ? "text-warn" : "text-subtle")} />
      </div>
      <p className="tabular mt-2 text-[28px] leading-none font-semibold tracking-tight">{value}</p>
      <div className="mt-2 text-xs text-subtle">{sub}</div>
    </div>
  );
  return href ? <Link href={href}>{body}</Link> : body;
}

/** Human summary of an audit log entry. */
function describe(a: Overview["activity"][number]) {
  const verb: Record<string, string> = {
    "server.enrolled": "enrolled", "server.removed": "removed server", "server.updated": "updated server", "user.login": "signed in", "user.invited": "invited",
    "user.joined": "joined", "policy.updated": "changed the update policy for", "updates.apply": "started updates on", "updates.check": "checked for updates on",
    "vulnerabilities.scan": "started a vulnerability scan of", "setup.completed": "finished setting up",
  };
  if (a.action === "user.login") return "signed in";
  if (verb[a.action]) return `${verb[a.action]} ${a.target}`;
  if (a.action.startsWith("command.")) return `${a.detail.charAt(0).toLowerCase()}${a.detail.slice(1)} on ${a.target}`;
  return `${a.action.replace(/[._]/g, " ")} ${a.target}`;
}

export function OverviewView() {
  const { can } = useMe();
  const { toast } = useToast();
  const [range, setRange] = useState<Range>("live");
  const { data, error } = useApi<Overview>(`/api/overview?range=${range}`, { interval: range === "live" ? 5000 : 60_000 });

  async function checkAll() {
    try {
      const r = await api<{ queued: number }>("/api/updates/check", { body: { serverIds: "all" } });
      toast({ title: "Update check requested", body: `Sent to ${r.queued} server(s). Results appear as each agent reports in.`, tone: "success" });
    } catch (err) {
      toast({ title: "Couldn't start update check", body: (err as Error).message, tone: "error" });
    }
  }

  if (error && !data) return <EmptyNote>Couldn&apos;t load the overview: {error.message}</EmptyNote>;
  if (!data) return <p className="text-sm text-muted">Loading…</p>;
  const f = data.fleet;
  const s = data.series;
  const latest = (a: number[]) => a[a.length - 1] ?? 0;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Fleet overview"
        description="Health, workloads and patch status across all connected Linux hosts."
        actions={
          <>
            <Segmented size="sm" value={range} onChange={setRange} options={[{ value: "live", label: "Live" }, { value: "1h", label: "1h" }, { value: "24h", label: "24h" }, { value: "7d", label: "7d" }]} />
            {can("updates.run") && f.total > 0 && (
              <Button icon={RefreshCw} onClick={checkAll}>
                Check for updates
              </Button>
            )}
          </>
        }
      />

      {f.total === 0 && (
        <div className="glass flex flex-col items-start gap-4 p-6 sm:flex-row sm:items-center">
          <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-primary-soft text-primary-fg">
            <Server className="size-5" />
          </span>
          <div className="flex-1">
            <p className="font-semibold">No servers yet</p>
            <p className="text-sm text-muted">Install the agent on a Linux server to start monitoring it. It connects out to this dashboard; no inbound ports needed.</p>
          </div>
          <Link href="/settings#enrolment">
            <Button variant="primary" icon={Plus}>
              Add a server
            </Button>
          </Link>
        </div>
      )}

      {data.critical.length > 0 && (
        <div className="glass flex flex-col gap-3 border-crit/40 bg-crit/[0.07] p-4 sm:flex-row sm:items-center">
          <div className="flex items-center gap-3">
            <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-crit/15 text-crit">
              <CircleAlert className="size-5" />
            </span>
            <div>
              <p className="text-sm font-semibold">
                {f.criticalAlerts} critical {f.criticalAlerts === 1 ? "issue needs" : "issues need"} attention
              </p>
              <p className="text-xs text-muted">
                {data.critical.map((a, i) => (
                  <span key={a.id}>
                    {i > 0 && " · "}
                    {a.hostname && <span className="font-medium text-fg">{a.hostname}</span>} {a.hostname && "— "}
                    {a.title.toLowerCase()}
                  </span>
                ))}
              </p>
            </div>
          </div>
          <Link href="/alerts" className="sm:ml-auto">
            <Button variant="danger" size="sm">
              Review alerts <ArrowRight className="size-3.5" />
            </Button>
          </Link>
        </div>
      )}

      <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-6">
        <StatTile
          label="Servers online"
          icon={Server}
          value={
            <>
              {f.online}
              <span className="text-lg text-subtle">/{f.total}</span>
            </>
          }
          sub={f.total - f.online > 0 ? <span className="text-crit">{f.total - f.online} offline</span> : "all reporting"}
          tone={f.total - f.online > 0 ? "warn" : "neutral"}
          href="/servers"
        />
        <StatTile label="Avg CPU" icon={Cpu} value={`${Math.round(latest(s.cpu))}%`} sub={`across ${f.online} online host${f.online === 1 ? "" : "s"}`} tone={latest(s.cpu) > 80 ? "warn" : "neutral"} />
        <StatTile label="Memory used" icon={MemoryStick} value={`${Math.round(latest(s.mem))}%`} sub={f.memTotal ? `${bytes(f.memUsed, 0)} of ${bytes(f.memTotal, 0)}` : "—"} tone={latest(s.mem) > 85 ? "warn" : "neutral"} />
        <StatTile
          label="Pending updates"
          icon={PackageCheck}
          value={f.pendingUpdates}
          sub={
            <span>
              <span className={cn(f.securityUpdates > 0 && "font-medium text-warn")}>{f.securityUpdates} security</span> · {f.rebootRequired} need reboot
            </span>
          }
          tone={f.securityUpdates ? "warn" : "neutral"}
          href="/updates"
        />
        <StatTile
          label="Vulnerabilities"
          icon={ShieldAlert}
          value={f.vulnCritical + f.vulnHigh}
          sub={<span className={cn(f.vulnCritical > 0 && "font-medium text-crit")}>{f.vulnCritical} critical · {f.vulnHigh} high</span>}
          tone={f.vulnCritical ? "crit" : f.vulnHigh ? "warn" : "neutral"}
          href="/vulnerabilities"
        />
        <StatTile label="Open alerts" icon={TriangleAlert} value={f.openAlerts} sub={<span className={cn(f.criticalAlerts > 0 && "font-medium text-crit")}>{f.criticalAlerts} critical</span>} tone={f.criticalAlerts ? "crit" : f.openAlerts ? "warn" : "neutral"} href="/alerts" />
      </div>

      <div className="grid gap-4 xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <CardHeader icon={Activity} title="Cluster utilisation" subtitle={`Mean CPU and memory across online hosts${s.hasData ? "" : " · waiting for data"}`} />
          <LiveChart
            height={240}
            max={100}
            stepMs={s.stepMs}
            animate={range === "live"}
            series={[
              { key: "cpu", label: "CPU", color: "var(--s1)", data: s.cpu },
              { key: "mem", label: "Memory", color: "var(--s2)", data: s.mem },
            ]}
          />
        </Card>
        <Card>
          <CardHeader icon={Network} title="Network throughput" subtitle="Total across fleet" />
          <LiveChart
            height={240}
            stepMs={s.stepMs}
            animate={range === "live"}
            format={(v) => rate(v)}
            minMax={1024 * 1024}
            area={false}
            series={[
              { key: "rx", label: "Inbound", color: "var(--s1)", data: s.rx },
              { key: "tx", label: "Outbound", color: "var(--s3)", data: s.tx },
            ]}
          />
        </Card>
      </div>

      <div className="grid gap-4 xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <CardHeader icon={Server} title="Hosts needing attention" subtitle="Sorted by severity" action={<Link href="/servers" className="text-xs font-medium text-primary-fg hover:underline">All servers</Link>} />
          {data.attention.length === 0 ? (
            <EmptyNote>No servers enrolled yet.</EmptyNote>
          ) : (
            <Table>
              <thead>
                <tr>
                  <th>Host</th>
                  <th>Status</th>
                  <th className="w-36">CPU</th>
                  <th className="w-36">Memory</th>
                  <th className="w-36">Disk</th>
                  <th>Updates</th>
                </tr>
              </thead>
              <tbody>
                {data.attention.map((h) => (
                  <tr key={h.id}>
                    <td>
                      <Link href={`/servers?open=${h.id}`} className="flex items-center gap-2.5">
                        <StatusDot status={h.status} />
                        <div className="min-w-0">
                          <p className="font-medium whitespace-nowrap">{h.name}</p>
                          <p className="max-w-56 truncate text-[11px] text-subtle">{h.issue ?? h.os}</p>
                        </div>
                      </Link>
                    </td>
                    <td>
                      <StatusBadge status={h.status} />
                    </td>
                    <td>{h.status === "offline" ? <span className="text-subtle">—</span> : <MeterRow label="" value={h.cpu} warn={70} crit={90} />}</td>
                    <td>{h.status === "offline" ? <span className="text-subtle">—</span> : <MeterRow label="" value={h.mem} warn={80} crit={92} />}</td>
                    <td>
                      <MeterRow label="" value={h.disk} warn={80} crit={90} />
                    </td>
                    <td>
                      {h.security > 0 ? (
                        <Badge tone="warn" icon={ShieldAlert}>
                          {h.updates} · {h.security} sec
                        </Badge>
                      ) : (
                        <span className="tabular text-muted">{h.updates}</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </Card>

        <Card>
          <CardHeader icon={TriangleAlert} title="Recent alerts" action={<Link href="/alerts" className="text-xs font-medium text-primary-fg hover:underline">View all</Link>} />
          {data.alerts.length === 0 ? (
            <EmptyNote>No open alerts. All clear.</EmptyNote>
          ) : (
            <ul className="space-y-1">
              {data.alerts.map((a) => (
                <li key={a.id} className="flex gap-3 rounded-lg p-2 hover:bg-fg/[0.03]">
                  <span className={cn("mt-1 w-1 shrink-0 self-stretch rounded-full", a.severity === "critical" ? "bg-crit" : a.severity === "warning" ? "bg-warn" : "bg-info")} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-2">
                      <p className="truncate text-sm font-medium">{a.title}</p>
                      <span className="shrink-0 text-[11px] text-subtle">{ago(a.last_seen)}</span>
                    </div>
                    <p className="truncate text-xs text-muted">{a.detail}</p>
                    {a.hostname && <p className="mt-0.5 font-mono text-[11px] text-subtle">{a.hostname}</p>}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        <Card>
          <CardHeader icon={Boxes} title="Applications" action={<Link href="/applications" className="text-xs font-medium text-primary-fg hover:underline">Manage</Link>} />
          <div className="space-y-3">
            {(["docker", "pm2", "systemd"] as const).map((k) => (
              <AppRuntime key={k} name={k === "pm2" ? "PM2" : k === "docker" ? "Docker" : "systemd"} {...data.apps[k]} />
            ))}
          </div>
        </Card>

        <Card>
          <CardHeader icon={CalendarClock} title="Auto-update policies" action={<Link href="/updates" className="text-xs font-medium text-primary-fg hover:underline">Edit</Link>} />
          <ul className="space-y-3">
            {data.policies.map((p) => (
              <li key={p.id} className="flex items-center gap-3 rounded-lg border border-line bg-inset p-3">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-medium">{p.name}</p>
                    {!p.enabled && <Badge>Off</Badge>}
                  </div>
                  <p className="text-xs text-muted">
                    {p.intervalHours && !p.start ? `Every ${p.intervalHours}h` : `${p.days.length ? p.days.join(", ") : "Daily"} ${p.start} ${p.timezone}`} · {p.scope === "security" ? "Security only" : "All updates"}
                  </p>
                </div>
                <span className="tabular text-xs text-subtle">
                  {p.servers} host{p.servers === 1 ? "" : "s"}
                </span>
              </li>
            ))}
          </ul>
        </Card>

        <Card className="md:col-span-2 xl:col-span-1">
          <CardHeader icon={History} title="Activity" />
          {data.activity.length === 0 ? (
            <EmptyNote>Nothing yet.</EmptyNote>
          ) : (
            <ol className="relative space-y-4 before:absolute before:inset-y-1 before:left-[5px] before:w-px before:bg-line-strong">
              {data.activity.map((a) => (
                <li key={a.id} className="relative flex gap-3 pl-5">
                  <span className="absolute top-1.5 left-0 size-[11px] rounded-full border-2 border-primary bg-bg" />
                  <div className="min-w-0">
                    <p className="text-sm">
                      <span className="font-medium">{a.user_name}</span> <span className="text-muted">{describe(a)}</span>
                    </p>
                    <p className="text-[11px] text-subtle">{ago(a.ts)}</p>
                  </div>
                </li>
              ))}
            </ol>
          )}
        </Card>
      </div>
    </div>
  );
}

function AppRuntime({ name, total, running, failing }: { name: string; total: number; running: number; failing: number }) {
  return (
    <div className="rounded-lg border border-line bg-inset p-3">
      <div className="flex items-center justify-between">
        <p className="text-sm font-medium">{name}</p>
        {total === 0 ? <Badge>Not detected</Badge> : failing > 0 ? <Badge tone="crit" icon={CircleAlert}>{failing} failing</Badge> : <StatusBadge status="healthy" />}
      </div>
      {total > 0 && (
        <>
          <div className="mt-2.5 flex h-1.5 gap-0.5 overflow-hidden rounded-full">
            <span className="bg-ok" style={{ flex: running }} />
            {failing > 0 && <span className="bg-crit" style={{ flex: failing }} />}
            {total - running - failing > 0 && <span className="bg-fg/15" style={{ flex: total - running - failing }} />}
          </div>
          <p className="tabular mt-1.5 text-[11px] text-subtle">
            {running} of {total} running
          </p>
        </>
      )}
    </div>
  );
}
