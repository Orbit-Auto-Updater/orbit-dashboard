"use client";

import { Boxes, CirclePlay, RotateCw, ScrollText, Search, Square, TriangleAlert } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { useConfirm } from "@/components/providers";
import { Badge, Card, CardHeader, cn, EmptyNote, IconButton, inputClass, PageHeader, Segmented, StatusBadge, Table } from "@/components/ui";
import { ago, bytes, duration, secondsSince, useApi, useCommand, useMe } from "@/lib/client";

type Base = { serverId: string; server: string; stale: boolean };
type Container = Base & { id: string; name: string; image: string; state: string; status: string; health?: string; restart_count: number; exit_code: number; oom_killed?: boolean; cpu_percent: number; mem_bytes: number; mem_limit_bytes: number; ports?: string[]; started_at?: string };
type Pm2 = Base & { user: string; pm_id: number; name: string; status: string; mode: string; cpu_percent: number; mem_bytes: number; restarts: number; started_at?: string };
type Unit = Base & { name: string; description?: string; active_state: string; sub_state: string; unit_file_state?: string; watched: boolean; restarts?: number };
type Data = { containers: Container[]; pm2: Pm2[]; units: Unit[]; errors: { server: string; runtime: string; error: string }[] };
type Tab = "docker" | "pm2" | "systemd";

const order = (list: string[]) => (s: string) => (list.indexOf(s) + 1 || 99);

export function ApplicationsView() {
  const [tab, setTab] = useState<Tab>("docker");
  const [q, setQ] = useState("");
  const { data, error, reload } = useApi<Data>("/api/applications", { interval: 10_000 });
  const run = useCommand();
  const confirm = useConfirm();
  const { can } = useMe();

  if (error && !data) return <EmptyNote>Couldn&apos;t load applications: {error.message}</EmptyNote>;
  if (!data) return <p className="text-sm text-muted">Loading…</p>;

  const match = (...xs: (string | undefined)[]) => q === "" || xs.join(" ").toLowerCase().includes(q.toLowerCase());
  const containers = data.containers.filter((c) => match(c.name, c.image, c.server)).sort((a, b) => order(["restarting", "dead", "exited", "paused", "created", "running"])(a.state) - order(["restarting", "dead", "exited", "paused", "created", "running"])(b.state) || (a.health === "unhealthy" ? -1 : 0));
  const pm2 = data.pm2.filter((p) => match(p.name, p.server, p.user)).sort((a, b) => order(["errored", "launching", "stopping", "stopped", "online"])(a.status) - order(["errored", "launching", "stopping", "stopped", "online"])(b.status));
  const units = data.units.filter((u) => match(u.name, u.server, u.description)).sort((a, b) => order(["failed", "activating", "deactivating", "inactive", "active"])(a.active_state) - order(["failed", "activating", "deactivating", "inactive", "active"])(b.active_state));

  async function act(serverId: string, kind: Tab, action: "start" | "stop" | "restart", label: string, args: Record<string, unknown>) {
    if (action === "stop" && !(await confirm({ title: `Stop ${label}?`, body: "It stays stopped until you start it again (or its restart policy brings it back).", confirmLabel: "Stop", danger: true }))) return;
    run(serverId, `${kind}.${action}`, args, reload);
  }

  const canControl = can("apps.control");
  const tile = (name: string, runtime: Tab, total: number, running: number, failing: number, servers: number) => (
    <button onClick={() => setTab(runtime)} className={cn("glass relative overflow-hidden p-4 text-left transition-colors hover:bg-glass-hover", tab === runtime && "border-primary/50 ring-1 ring-primary/30")}>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <span className="grid size-8 place-items-center rounded-lg bg-primary-soft text-primary-fg">
            <Boxes className="size-4" />
          </span>
          <div>
            <p className="text-sm font-semibold">{name}</p>
            <p className="text-[11px] text-subtle">{total ? `on ${servers} server${servers === 1 ? "" : "s"}` : "not detected"}</p>
          </div>
        </div>
        {failing > 0 ? <StatusBadge status="critical" label={`${failing} failing`} /> : total > 0 ? <StatusBadge status="healthy" /> : null}
      </div>
      <p className="tabular mt-4 text-2xl font-semibold">
        {running}
        <span className="text-base text-subtle">/{total} running</span>
      </p>
    </button>
  );
  const count = <T extends Base>(xs: T[]) => new Set(xs.map((x) => x.serverId)).size;

  return (
    <div className="space-y-6">
      <PageHeader title="Applications" description="Containers, PM2 processes and system services reported by each server's agent." />

      <div className="grid gap-4 sm:grid-cols-3">
        {tile("Docker", "docker", data.containers.length, data.containers.filter((c) => c.state === "running").length, data.containers.filter((c) => c.state === "restarting" || c.health === "unhealthy").length, count(data.containers))}
        {tile("PM2", "pm2", data.pm2.length, data.pm2.filter((p) => p.status === "online").length, data.pm2.filter((p) => p.status === "errored").length, count(data.pm2))}
        {tile("systemd", "systemd", data.units.length, data.units.filter((u) => u.active_state === "active").length, data.units.filter((u) => u.active_state === "failed").length, count(data.units))}
      </div>

      {data.errors.length > 0 && (
        <div className="glass border-warn/30 p-4 text-sm">
          <p className="mb-1 flex items-center gap-2 font-medium text-warn">
            <TriangleAlert className="size-4" /> Some runtimes couldn&apos;t be read
          </p>
          <ul className="space-y-0.5 text-xs text-muted">
            {data.errors.map((e, i) => (
              <li key={i}>
                <span className="font-mono text-fg">{e.server}</span> · {e.runtime}: {e.error}
              </li>
            ))}
          </ul>
        </div>
      )}

      <Card>
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <Segmented value={tab} onChange={setTab} size="sm" options={[{ value: "docker", label: "Docker", count: data.containers.length }, { value: "pm2", label: "PM2", count: data.pm2.length }, { value: "systemd", label: "systemd", count: data.units.length }]} />
          <div className="relative w-full sm:w-64">
            <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-subtle" />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Filter" className={cn(inputClass, "h-8 pl-9 text-xs")} />
          </div>
        </div>

        {tab === "docker" &&
          (containers.length === 0 ? (
            <EmptyNote>No containers reported. The agent reads Docker through /var/run/docker.sock when it exists.</EmptyNote>
          ) : (
            <Table>
              <thead>
                <tr>
                  <th>Container</th>
                  <th>Server</th>
                  <th>Status</th>
                  <th className="text-right">CPU</th>
                  <th className="text-right">Memory</th>
                  <th>Ports</th>
                  <th className="text-right">Restarts</th>
                  {canControl && <th className="text-right">Actions</th>}
                </tr>
              </thead>
              <tbody>
                {containers.map((c) => (
                  <tr key={`${c.serverId}:${c.id}`} className={cn(c.state === "restarting" && "bg-crit/[0.05]", c.stale && "opacity-60")}>
                    <td>
                      <p className="font-medium">{c.name}</p>
                      <p className="max-w-64 truncate font-mono text-[11px] text-subtle">{c.image}</p>
                    </td>
                    <td className="font-mono text-xs whitespace-nowrap text-muted">{c.server}</td>
                    <td>
                      <div className="flex flex-wrap items-center gap-1">
                        <StatusBadge status={c.state} />
                        {c.health === "unhealthy" && <Badge tone="crit">unhealthy</Badge>}
                        {c.oom_killed && <Badge tone="crit">OOM</Badge>}
                      </div>
                      <p className="mt-0.5 text-[11px] text-subtle">{c.status}</p>
                    </td>
                    <td className="tabular text-right">{c.state === "running" ? `${c.cpu_percent.toFixed(1)}%` : "—"}</td>
                    <td className="tabular text-right whitespace-nowrap text-muted">{c.mem_bytes ? bytes(c.mem_bytes) : "—"}</td>
                    <td className="font-mono text-xs text-muted">{c.ports?.join(", ") || "—"}</td>
                    <td className={cn("tabular text-right", c.restart_count > 5 ? "font-semibold text-crit" : "text-muted")}>{c.restart_count}</td>
                    {canControl && (
                      <td>
                        <Actions running={c.state === "running"} name={c.name} onAction={(a) => act(c.serverId, "docker", a, c.name, { id: c.name })} />
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </Table>
          ))}

        {tab === "pm2" &&
          (pm2.length === 0 ? (
            <EmptyNote>No PM2 processes reported. Enable PM2 for the users that run it in the agent config (the installer asks).</EmptyNote>
          ) : (
            <Table>
              <thead>
                <tr>
                  <th>App</th>
                  <th>Server</th>
                  <th>Status</th>
                  <th>Mode</th>
                  <th className="text-right">CPU</th>
                  <th className="text-right">Memory</th>
                  <th className="text-right">Restarts</th>
                  <th>Uptime</th>
                  {canControl && <th className="text-right">Actions</th>}
                </tr>
              </thead>
              <tbody>
                {pm2.map((p) => (
                  <tr key={`${p.serverId}:${p.user}:${p.pm_id}`} className={cn(p.status === "errored" && "bg-crit/[0.05]", p.stale && "opacity-60")}>
                    <td>
                      <p className="font-medium">{p.name}</p>
                      {p.user && <p className="text-[11px] text-subtle">user {p.user}</p>}
                    </td>
                    <td className="font-mono text-xs text-muted">{p.server}</td>
                    <td>
                      <StatusBadge status={p.status} />
                    </td>
                    <td>
                      <Badge>{p.mode}</Badge>
                    </td>
                    <td className="tabular text-right">{p.status === "online" ? `${p.cpu_percent}%` : "—"}</td>
                    <td className="tabular text-right whitespace-nowrap text-muted">{p.mem_bytes ? bytes(p.mem_bytes) : "—"}</td>
                    <td className={cn("tabular text-right", p.restarts > 5 ? "font-semibold text-crit" : "text-muted")}>{p.restarts}</td>
                    <td className="tabular text-muted">{p.started_at ? duration(secondsSince(p.started_at)) : "—"}</td>
                    {canControl && (
                      <td>
                        <Actions running={p.status === "online"} name={p.name} onAction={(a) => act(p.serverId, "pm2", a, p.name, { name: p.name, user: p.user || undefined })} />
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </Table>
          ))}

        {tab === "systemd" &&
          (units.length === 0 ? (
            <EmptyNote>No units reported. Watched units come from the agent config; failed units are always shown.</EmptyNote>
          ) : (
            <Table>
              <thead>
                <tr>
                  <th>Unit</th>
                  <th>Server</th>
                  <th>State</th>
                  <th>Sub-state</th>
                  <th>Enabled</th>
                  {canControl && <th className="text-right">Actions</th>}
                </tr>
              </thead>
              <tbody>
                {units.map((u) => (
                  <tr key={`${u.serverId}:${u.name}`} className={cn(u.active_state === "failed" && "bg-crit/[0.05]", u.stale && "opacity-60")}>
                    <td>
                      <p className="font-mono text-xs font-medium">{u.name}</p>
                      {u.description && <p className="text-[11px] text-subtle">{u.description}</p>}
                    </td>
                    <td className="font-mono text-xs text-muted">{u.server}</td>
                    <td>
                      <StatusBadge status={u.active_state} />
                    </td>
                    <td className="text-muted">{u.sub_state}</td>
                    <td>{u.unit_file_state ? <Badge tone={u.unit_file_state === "enabled" ? "primary" : "neutral"}>{u.unit_file_state}</Badge> : <span className="text-subtle">—</span>}</td>
                    {canControl && (
                      <td>
                        {u.watched ? (
                          <Actions running={u.active_state === "active"} name={u.name} onAction={(a) => act(u.serverId, "systemd", a, u.name, { unit: u.name })} />
                        ) : (
                          <p className="text-right text-[11px] text-subtle" title="Add the unit to systemd.watch in the agent config to control it">not watched</p>
                        )}
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </Table>
          ))}
      </Card>

      <RecentErrors />
    </div>
  );
}

function Actions({ running, name, onAction }: { running: boolean; name: string; onAction: (a: "start" | "stop" | "restart") => void }) {
  return (
    <div className="flex justify-end gap-0.5">
      <IconButton icon={RotateCw} label={`Restart ${name}`} onClick={() => onAction("restart")} />
      {running ? <IconButton icon={Square} label={`Stop ${name}`} onClick={() => onAction("stop")} /> : <IconButton icon={CirclePlay} label={`Start ${name}`} onClick={() => onAction("start")} />}
    </div>
  );
}

function RecentErrors() {
  const { data } = useApi<{ logs: { id: string; ts: number; priority: number; unit: string; message: string; server: string; server_id: string }[] }>("/api/logs?limit=60", { interval: 15_000 });
  const logs = data?.logs ?? [];
  return (
    <Card>
      <CardHeader icon={ScrollText} title="Recent errors" subtitle="journald entries at error level and above, from every server" action={<Link href="/alerts?tab=logs" className="text-xs font-medium text-primary-fg hover:underline">All logs</Link>} />
      {logs.length === 0 ? (
        <EmptyNote>No errors logged recently.</EmptyNote>
      ) : (
        <div className="max-h-72 space-y-1 overflow-y-auto rounded-lg border border-line bg-inset p-3 font-mono text-[11px] leading-relaxed scrollbar-thin">
          {logs.map((l) => (
            <p key={l.id} className="flex gap-2">
              <span className="shrink-0 text-subtle">{ago(l.ts)}</span>
              <span className="w-28 shrink-0 truncate text-primary-fg">{l.server}</span>
              <span className="w-32 shrink-0 truncate text-muted">{l.unit}</span>
              <span className={cn("min-w-0 break-words", l.priority <= 3 ? "text-crit" : "text-warn")}>{l.message}</span>
            </p>
          ))}
        </div>
      )}
    </Card>
  );
}
