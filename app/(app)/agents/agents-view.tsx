"use client";

import { Ban, Bot, Check, ChevronDown, CircleArrowUp, CircleCheck, CircleHelp, Copy, FileCog, Package, RotateCcw, Terminal } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { Enrolment } from "@/components/enrolment";
import { useConfirm, useToast } from "@/components/providers";
import { Badge, Button, Card, CardHeader, cn, EmptyNote, EnvBadge, PageHeader, Segmented, Table, type Env } from "@/components/ui";
import { ago, api, bytes, dateTime, useApi, useMe } from "@/lib/client";

type Info = {
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
type Agent = {
  id: string;
  name: string;
  environment: string;
  arch: string;
  os: string;
  version: string;
  versionStatus: "current" | "outdated" | "newer" | "unknown";
  online: boolean;
  lastSeen: number;
  info: Info | null;
  updating: { jobId: string; phase: string } | null;
  canUpdate: boolean;
  blocker: string | null;
};
type Data = {
  release: { version: string | null; builtAt: number; arches: { arch: string; sha256: string; size: number }[] } | null;
  agents: Agent[];
  counts: { total: number; current: number; outdated: number; updatable: number };
};

const ACTIONS: [string, string][] = [["updates", "Install updates"], ["reboot", "Reboot"], ["docker", "Docker"], ["pm2", "PM2"], ["systemd", "systemd"], ["agent_update", "Self-update"]];
const FEATURES: [string, string][] = [["updates", "Package updates"], ["docker", "Docker"], ["pm2", "PM2"], ["systemd", "systemd"], ["journal", "Journal errors"]];

function VersionBadge({ a }: { a: Agent }) {
  if (a.versionStatus === "current") return <Badge tone="ok" icon={CircleCheck}>{a.version}</Badge>;
  if (a.versionStatus === "outdated") return <Badge tone="warn" icon={CircleArrowUp}>{a.version}</Badge>;
  if (a.versionStatus === "newer") return <Badge tone="info">{a.version}</Badge>;
  return <Badge icon={CircleHelp}>{a.version || "unknown"}</Badge>;
}

export function AgentsView() {
  const { can } = useMe();
  const { toast } = useToast();
  const confirm = useConfirm();
  const [filter, setFilter] = useState<"all" | "outdated" | "blocked">("all");
  const [open, setOpen] = useState<string | null>(null);
  const { data, error } = useApi<Data>("/api/agents", { interval: 10_000 });

  async function update(serverIds: string[] | "outdated", what: string) {
    const target = data!.release?.version;
    if (!(await confirm({ title: `Update ${what} to ${target}?`, body: <>Each agent downloads the new version from this dashboard, checks its SHA-256 and that it accepts the server&apos;s config, then swaps itself in and restarts. The update is confirmed when the server reports in on the new version. If it can&apos;t, the agent rolls back to the previous binary on its own. Monitoring pauses for a few seconds per server.</>, confirmLabel: "Update" }))) return;
    try {
      const r = await api<{ jobId: string; queued: number; skipped: { server: string; reason: string }[] }>("/api/agents/update", { body: { serverIds } });
      if (r.skipped.length) toast({ title: `${r.skipped.length} server(s) skipped`, body: r.skipped.map((s) => `${s.server}: ${s.reason}`).join("\n"), tone: "info" });
      window.location.assign(`/jobs/${r.jobId}`);
    } catch (err) {
      toast({ title: "Couldn't start the agent update", body: (err as Error).message, tone: "error" });
    }
  }

  if (error && !data) return <EmptyNote>Couldn&apos;t load agents: {error.message}</EmptyNote>;
  if (!data) return <p className="text-sm text-muted">Loading…</p>;

  const r = data.release;
  const blocked = data.agents.filter((a) => a.versionStatus === "outdated" && a.blocker);
  const list = data.agents.filter((a) => filter === "all" || (filter === "outdated" ? a.versionStatus === "outdated" : !!a.blocker));
  const manage = can("servers.manage");

  return (
    <div className="space-y-6">
      <PageHeader
        title="Agents"
        description="The agent running on each server: its version, what its local config allows, and enrolment for new servers."
        actions={
          manage && data.counts.updatable > 0 && r?.version ? (
            <Button variant="primary" icon={CircleArrowUp} onClick={() => update("outdated", `${data.counts.updatable} outdated agent${data.counts.updatable === 1 ? "" : "s"}`)}>
              Update {data.counts.updatable} outdated
            </Button>
          ) : undefined
        }
      />

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-1">
          <CardHeader icon={Package} title="Version this dashboard ships" subtitle={r ? `Built ${dateTime(r.builtAt)}` : undefined} />
          {!r ? (
            <p className="text-sm text-warn">No agent binaries found. Run <code className="font-mono text-xs">make release VERSION=x.y.z</code> in the agent repo (or rebuild the Docker image), then refresh.</p>
          ) : (
            <>
              <p className="tabular text-3xl font-semibold tracking-tight">{r.version ?? <span className="text-warn">unversioned</span>}</p>
              {!r.version && <p className="mt-1 text-xs text-warn">This build has no VERSION file; rebuild with <code className="font-mono">make release VERSION=x.y.z</code> to enable one-click updates.</p>}
              <ul className="mt-4 space-y-1.5 text-xs">
                {r.arches.map((x) => (
                  <li key={x.arch} className="flex items-center justify-between gap-3">
                    <span className="font-mono">linux-{x.arch}</span>
                    <span className="truncate font-mono text-subtle" title={x.sha256}>
                      {bytes(x.size)} · sha256 {x.sha256.slice(0, 12)}…
                    </span>
                  </li>
                ))}
              </ul>
            </>
          )}
        </Card>

        <div className="grid grid-cols-2 gap-4 lg:col-span-2">
          {[
            ["Agents", data.counts.total, "enrolled servers", "neutral"],
            ["Up to date", data.counts.current, r?.version ? `running ${r.version}` : "—", "ok"],
            ["Outdated", data.counts.outdated, `${data.counts.updatable} can update in one click`, data.counts.outdated ? "warn" : "neutral"],
            ["Need attention", blocked.length, "outdated but can't self-update", blocked.length ? "crit" : "neutral"],
          ].map(([label, value, sub, tone]) => (
            <div key={label as string} className={cn("glass relative overflow-hidden p-4", tone === "warn" && "border-warn/30", tone === "crit" && "border-crit/30")}>
              {(tone === "warn" || tone === "crit") && <span className={cn("absolute inset-x-0 top-0 h-0.5", tone === "warn" ? "bg-warn" : "bg-crit")} />}
              <p className="text-xs font-medium text-muted">{label}</p>
              <p className={cn("tabular mt-2 text-[28px] leading-none font-semibold", tone === "ok" && (value as number) > 0 && "text-ok")}>{value}</p>
              <p className="mt-2 text-xs text-subtle">{sub}</p>
            </div>
          ))}
        </div>
      </div>

      <Card>
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <Segmented size="sm" value={filter} onChange={setFilter} options={[{ value: "all", label: "All", count: data.agents.length }, { value: "outdated", label: "Outdated", count: data.counts.outdated }, { value: "blocked", label: "Can't self-update", count: data.agents.filter((a) => a.blocker).length }]} />
        </div>
        {list.length === 0 ? (
          <EmptyNote>{data.agents.length ? "Nothing in this filter." : "No agents enrolled yet. Create an enrolment token below."}</EmptyNote>
        ) : (
          <Table>
            <thead>
              <tr>
                <th>Server</th>
                <th>Version</th>
                <th>Remote actions allowed</th>
                <th>Self-update</th>
                <th className="text-right" />
              </tr>
            </thead>
            {list.map((a) => (
              <tbody key={a.id}>
                <tr className="cursor-pointer" onClick={() => setOpen(open === a.id ? null : a.id)}>
                  <td>
                    <div className="flex items-center gap-2.5">
                      <span className={cn("size-2 shrink-0 rounded-full", a.online ? "bg-ok" : "bg-subtle")} title={a.online ? "online" : `last seen ${ago(a.lastSeen)}`} />
                      <div>
                        <p className="font-medium">{a.name}</p>
                        <p className="text-[11px] text-subtle">
                          {a.os} · {a.arch}
                        </p>
                      </div>
                      <EnvBadge env={a.environment as Env} />
                    </div>
                  </td>
                  <td>
                    <VersionBadge a={a} />
                  </td>
                  <td>
                    {a.info ? (
                      <div className="flex flex-wrap gap-1">
                        {ACTIONS.map(([k, label]) => (
                          <span key={k} className={cn("inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] ring-1 ring-inset", a.info!.actions[k] ? "text-fg ring-line-strong" : "text-subtle line-through ring-line")}>
                            {a.info!.actions[k] ? <Check className="size-2.5 text-ok" /> : <Ban className="size-2.5" />}
                            {label}
                          </span>
                        ))}
                      </div>
                    ) : (
                      <span className="text-xs text-subtle">not reported</span>
                    )}
                  </td>
                  <td className="text-xs">
                    {a.updating ? (
                      <Link href={`/jobs/${a.updating.jobId}`} onClick={(e) => e.stopPropagation()} className="font-medium text-primary-fg hover:underline">
                        Updating… {a.updating.phase && `(${a.updating.phase})`}
                      </Link>
                    ) : a.blocker ? (
                      <span className="text-warn">{a.blocker}</span>
                    ) : (
                      <span className="text-muted">Ready{a.info?.supervisor ? ` (${a.info.supervisor})` : ""}</span>
                    )}
                  </td>
                  <td>
                    <div className="flex items-center justify-end gap-2">
                      {manage && a.canUpdate && r?.version && a.versionStatus !== "current" && (
                        <Button size="sm" icon={CircleArrowUp} onClick={(e) => (e.stopPropagation(), update([a.id], a.name))}>
                          Update
                        </Button>
                      )}
                      <ChevronDown className={cn("size-4 text-subtle transition-transform", open === a.id && "rotate-180")} />
                    </div>
                  </td>
                </tr>
                {open === a.id && (
                  <tr className="!border-t-0 hover:!bg-transparent">
                    <td colSpan={5} className="!pt-0">
                      <AgentDetails a={a} />
                    </td>
                  </tr>
                )}
              </tbody>
            ))}
          </Table>
        )}
      </Card>

      {manage && <Enrolment />}
      {manage && <ManualUpgrade />}
    </div>
  );
}

function AgentDetails({ a }: { a: Agent }) {
  const i = a.info;
  if (!i) {
    return (
      <div className="rounded-lg border border-line bg-inset p-4 text-sm text-muted">
        This agent ({a.version}) predates configuration reporting and self-update. Re-run the installer on the server once (see “Upgrading by hand” below); after that it can be updated from here.
      </div>
    );
  }
  return (
    <div className="grid gap-4 rounded-lg border border-line bg-inset p-4 text-xs md:grid-cols-3">
      <div>
        <p className="mb-2 font-semibold text-muted">Runtime</p>
        <dl className="space-y-1">
          {[
            ["Version", i.version],
            ["Service manager", i.supervisor || "none (started by hand)"],
            ["Reports every", `${i.report_interval_seconds}s`],
            ["Package manager", i.package_manager || "none detected"],
            ["Last seen", ago(a.lastSeen)],
          ].map(([k, v]) => (
            <div key={k} className="flex justify-between gap-3">
              <dt className="text-subtle">{k}</dt>
              <dd className="font-mono">{v}</dd>
            </div>
          ))}
        </dl>
      </div>
      <div>
        <p className="mb-2 font-semibold text-muted">Monitoring</p>
        <ul className="space-y-1">
          {FEATURES.map(([k, label]) => (
            <li key={k} className="flex items-center gap-1.5">
              {i.features[k] ? <Check className="size-3 text-ok" /> : <Ban className="size-3 text-subtle" />}
              <span className={i.features[k] ? "" : "text-subtle"}>{label}</span>
            </li>
          ))}
        </ul>
        {i.last_update && (
          <p className={cn("mt-3 flex items-start gap-1.5", i.last_update.status === "rolled_back" ? "text-crit" : "text-ok")}>
            {i.last_update.status === "rolled_back" ? <RotateCcw className="mt-0.5 size-3 shrink-0" /> : <CircleCheck className="mt-0.5 size-3 shrink-0" />}
            <span>
              Last self-update {i.last_update.from} → {i.last_update.to}: {i.last_update.status === "rolled_back" ? `rolled back (${i.last_update.detail})` : "confirmed"}
            </span>
          </p>
        )}
      </div>
      <div>
        <p className="mb-2 flex items-center gap-1.5 font-semibold text-muted">
          <FileCog className="size-3.5" /> Changing this agent&apos;s config
        </p>
        <p className="text-subtle">
          The config lives on the server and the dashboard can&apos;t change it, by design: the server decides what the dashboard may do. Edit it, check it, and restart:
        </p>
        <pre className="mt-2 overflow-x-auto rounded bg-[#05070f] p-2 font-mono text-[11px] text-slate-300">
          {`sudo nano ${i.config_path || "/etc/orbit-agent/config.yaml"}
sudo orbit-agent validate
sudo systemctl restart orbit-agent`}
        </pre>
      </div>
    </div>
  );
}

function ManualUpgrade() {
  const { toast } = useToast();
  const [origin, setOrigin] = useState("");
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setOrigin(window.location.origin);
  }, []);
  const cmd = `curl -fsSL ${origin || "https://your-dashboard"}/install.sh | sudo sh -s -- --yes`;
  return (
    <Card>
      <CardHeader icon={Terminal} title="Upgrading by hand" subtitle="For agents that can't self-update (older versions, or not run as a service)" />
      <p className="text-sm text-muted">Run this on the server. The installer keeps the existing config and identity, replaces the binary and restarts the service.</p>
      <div className="mt-3 flex items-center gap-2 rounded-lg border border-line bg-inset p-3">
        <code className="min-w-0 flex-1 overflow-x-auto font-mono text-[11px] whitespace-nowrap scrollbar-thin">{cmd}</code>
        <Button size="sm" variant="ghost" icon={Copy} onClick={() => navigator.clipboard?.writeText(cmd).then(() => toast({ title: "Copied", tone: "success" }))}>
          Copy
        </Button>
      </div>
      <p className="mt-2 flex items-center gap-1.5 text-[11px] text-subtle">
        <Bot className="size-3" /> After one manual upgrade, agents report their config here and update in one click.
      </p>
    </Card>
  );
}
