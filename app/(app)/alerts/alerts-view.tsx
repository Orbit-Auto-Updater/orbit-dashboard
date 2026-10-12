"use client";

import { BellRing, Check, CircleAlert, History, Info, ScrollText, Search, TriangleAlert, Undo2 } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { useState } from "react";
import { useToast } from "@/components/providers";
import { Badge, Button, Card, CardHeader, cn, EmptyNote, inputClass, PageHeader, Segmented, Toggle } from "@/components/ui";
import { ago, api, dateTime, useApi, useMe } from "@/lib/client";

type Severity = "critical" | "warning" | "info";
type Alert = { id: string; server_id: string | null; server: string | null; severity: Severity; source: string; title: string; detail: string; status: "open" | "acknowledged" | "resolved"; first_seen: number; last_seen: number; acknowledged_at: number | null; acknowledged_by_name: string | null; resolved_at: number | null };
type Rule = { id: string; kind: string; name: string; threshold: number; duration_minutes: number; severity: Severity; enabled: number };

const sevStyle: Record<Severity, { icon: typeof Info; color: string; bar: string; bg: string }> = {
  critical: { icon: CircleAlert, color: "text-crit", bar: "bg-crit", bg: "bg-crit/[0.06] border-crit/30" },
  warning: { icon: TriangleAlert, color: "text-warn", bar: "bg-warn", bg: "border-line" },
  info: { icon: Info, color: "text-info", bar: "bg-info", bg: "border-line" },
};

export function AlertsView() {
  const initialTab = useSearchParams().get("tab");
  const [tab, setTab] = useState<"alerts" | "logs" | "audit">(initialTab === "logs" || initialTab === "audit" ? initialTab : "alerts");
  return (
    <div className="space-y-6">
      <PageHeader title="Alerts & logs" description="Threshold breaches, failures and vulnerabilities across your servers, plus the journald error log and an audit trail." />
      <Segmented value={tab} onChange={setTab} options={[{ value: "alerts", label: "Alerts" }, { value: "logs", label: "Server logs" }, { value: "audit", label: "Audit log" }]} />
      {tab === "alerts" ? <AlertsTab /> : tab === "logs" ? <LogsTab /> : <AuditTab />}
    </div>
  );
}

function AlertsTab() {
  const { can } = useMe();
  const { toast } = useToast();
  const [showResolved, setShowResolved] = useState(false);
  const [sev, setSev] = useState<"all" | Severity>("all");
  const [q, setQ] = useState("");
  const { data, error, reload } = useApi<{ alerts: Alert[]; rules: Rule[] }>(`/api/alerts${showResolved ? "?resolved=1" : ""}`, { interval: 10_000 });

  if (error && !data) return <EmptyNote>Couldn&apos;t load alerts: {error.message}</EmptyNote>;
  if (!data) return <p className="text-sm text-muted">Loading…</p>;

  const visible = data.alerts.filter((a) => (sev === "all" || a.severity === sev) && (q === "" || `${a.title} ${a.detail} ${a.server} ${a.source}`.toLowerCase().includes(q.toLowerCase())));
  const count = (s: Severity) => data.alerts.filter((a) => a.severity === s && a.status === "open").length;

  async function act(a: Alert, action: "acknowledge" | "unacknowledge" | "resolve") {
    try {
      await api(`/api/alerts/${a.id}`, { method: "PATCH", body: { action } });
      reload();
    } catch (err) {
      toast({ title: "Couldn't update alert", body: (err as Error).message, tone: "error" });
    }
  }

  return (
    <>
      <div className="grid grid-cols-3 gap-4">
        {(["critical", "warning", "info"] as Severity[]).map((s) => {
          const st = sevStyle[s];
          return (
            <button key={s} onClick={() => setSev(sev === s ? "all" : s)} className={cn("glass p-4 text-left transition-colors hover:bg-glass-hover", sev === s && "ring-1 ring-primary/40", s === "critical" && count(s) > 0 && "border-crit/40")}>
              <div className="flex items-center gap-2">
                <st.icon className={cn("size-4", st.color)} />
                <span className="text-xs font-medium text-muted capitalize">{s}</span>
              </div>
              <p className={cn("tabular mt-2 text-2xl font-semibold", s === "critical" && count(s) > 0 && "text-crit")}>{count(s)}</p>
              <p className="text-[11px] text-subtle">open</p>
            </button>
          );
        })}
      </div>

      <div className="grid gap-4 xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center">
            <Segmented size="sm" value={sev} onChange={setSev} options={[{ value: "all", label: "All" }, { value: "critical", label: "Critical" }, { value: "warning", label: "Warning" }, { value: "info", label: "Info" }]} />
            <div className="relative flex-1">
              <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-subtle" />
              <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search alerts" className={cn(inputClass, "h-8 pl-9 text-xs")} />
            </div>
            <label className="flex items-center gap-2 text-xs text-muted">
              <Toggle label="Show resolved" defaultChecked={showResolved} onChange={setShowResolved} />
              Resolved
            </label>
          </div>

          <ul className="space-y-2">
            {visible.length === 0 && <li className="py-10 text-center text-sm text-subtle">Nothing here. All clear.</li>}
            {visible.map((a) => {
              const st = sevStyle[a.severity];
              return (
                <li key={a.id} className={cn("flex gap-3 rounded-xl border p-3.5", st.bg, a.status !== "open" && "opacity-60")}>
                  <span className={cn("w-1 shrink-0 rounded-full", st.bar)} />
                  <st.icon className={cn("mt-0.5 size-4 shrink-0", st.color)} />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="text-sm font-semibold">{a.title}</p>
                      <Badge className="font-mono">{a.source}</Badge>
                      {a.status === "acknowledged" && <Badge tone="ok" icon={Check}>ack by {a.acknowledged_by_name ?? "someone"}</Badge>}
                      {a.status === "resolved" && <Badge tone="ok">resolved {ago(a.resolved_at)}</Badge>}
                    </div>
                    <p className="mt-0.5 text-sm text-muted">{a.detail}</p>
                    <p className="mt-1 text-[11px] text-subtle">
                      {a.server && <span className="font-mono">{a.server} · </span>}since {ago(a.first_seen)}
                      {a.last_seen - a.first_seen > 60_000 && ` · last seen ${ago(a.last_seen)}`}
                    </p>
                  </div>
                  {can("alerts.ack") && a.status !== "resolved" && (
                    <div className="flex shrink-0 flex-col gap-1 sm:flex-row">
                      {a.status === "open" ? (
                        <Button size="sm" variant="ghost" icon={Check} onClick={() => act(a, "acknowledge")}>
                          Ack
                        </Button>
                      ) : (
                        <Button size="sm" variant="ghost" icon={Undo2} onClick={() => act(a, "unacknowledge")}>
                          Un-ack
                        </Button>
                      )}
                      <Button size="sm" variant="ghost" onClick={() => act(a, "resolve")}>
                        Resolve
                      </Button>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
          <p className="mt-4 text-[11px] text-subtle">Alerts resolve themselves when the condition clears. Resolving one by hand reopens it if the problem is still there.</p>
        </Card>

        <RulesCard rules={data.rules} onSaved={reload} />
      </div>
    </>
  );
}

const RULE_HELP: Record<string, { unit?: string; duration?: string }> = {
  cpu: { unit: "%", duration: "for at least (min)" },
  memory: { unit: "%", duration: "for at least (min)" },
  disk: { unit: "% used" },
  offline: { duration: "after (min) without a report" },
  cve: { unit: "minimum CVSS score" },
};

function RulesCard({ rules, onSaved }: { rules: Rule[]; onSaved: () => void }) {
  const { can } = useMe();
  const { toast } = useToast();
  const editable = can("servers.manage");

  async function save(r: Rule, patch: Partial<Rule>) {
    const next = { ...r, ...patch };
    try {
      await api(`/api/alert-rules/${r.id}`, { method: "PUT", body: { enabled: next.enabled === 1, severity: next.severity, threshold: next.threshold, durationMinutes: next.duration_minutes } });
      onSaved();
    } catch (err) {
      toast({ title: "Couldn't save rule", body: (err as Error).message, tone: "error" });
    }
  }

  return (
    <Card>
      <CardHeader icon={BellRing} title="Alert rules" subtitle="Webhook notifications are set up in Settings" />
      <ul className="divide-y divide-line">
        {rules.map((r) => {
          const help = RULE_HELP[r.kind] ?? {};
          return (
            <li key={r.id} className="space-y-2 py-3 first:pt-0">
              <div className="flex items-center gap-3">
                <p className="min-w-0 flex-1 text-sm font-medium">{r.name}</p>
                {editable ? <Toggle label={`Enable ${r.name}`} defaultChecked={r.enabled === 1} onChange={(v) => save(r, { enabled: v ? 1 : 0 })} /> : <Badge>{r.enabled ? "on" : "off"}</Badge>}
              </div>
              {editable && r.enabled === 1 && (
                <div className="flex flex-wrap items-center gap-2 text-[11px] text-subtle">
                  <select className={cn(inputClass, "h-7 !w-auto text-[11px]")} defaultValue={r.severity} onChange={(e) => save(r, { severity: e.target.value as Severity })} aria-label="Severity">
                    <option value="critical">critical</option>
                    <option value="warning">warning</option>
                    <option value="info">info</option>
                  </select>
                  {help.unit && (
                    <label className="flex items-center gap-1">
                      <input type="number" className={cn(inputClass, "h-7 !w-16 text-[11px]")} defaultValue={r.threshold} min={1} max={r.kind === "cve" ? 10 : 100} onBlur={(e) => Number(e.target.value) !== r.threshold && save(r, { threshold: Number(e.target.value) })} />
                      {help.unit}
                    </label>
                  )}
                  {help.duration && (
                    <label className="flex items-center gap-1">
                      {help.duration.split(" (min)")[0]}
                      <input type="number" className={cn(inputClass, "h-7 !w-14 text-[11px]")} defaultValue={r.duration_minutes} min={0} max={1440} onBlur={(e) => Number(e.target.value) !== r.duration_minutes && save(r, { duration_minutes: Number(e.target.value) })} />
                      min{help.duration.split(" (min)")[1] ?? ""}
                    </label>
                  )}
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </Card>
  );
}

const PRIO = ["emerg", "alert", "crit", "err", "warn", "notice", "info", "debug"];

function LogsTab() {
  const [server, setServer] = useState("");
  const [q, setQ] = useState("");
  const { data: servers } = useApi<{ servers: { id: string; name: string }[] }>("/api/servers", { interval: false });
  const { data } = useApi<{ logs: { id: string; ts: number; priority: number; unit: string; message: string; server: string }[] }>(`/api/logs?limit=500${server ? `&server=${server}` : ""}`, { interval: 10_000 });
  const logs = (data?.logs ?? []).filter((l) => q === "" || `${l.unit} ${l.message} ${l.server}`.toLowerCase().includes(q.toLowerCase()));
  return (
    <Card>
      <CardHeader icon={ScrollText} title="Journal errors" subtitle="Entries at the priority set in each agent's config (error and above by default)" />
      <div className="mb-3 flex flex-col gap-2 sm:flex-row">
        <select className={cn(inputClass, "h-8 text-xs sm:!w-56")} value={server} onChange={(e) => setServer(e.target.value)} aria-label="Server">
          <option value="">All servers</option>
          {servers?.servers.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-subtle" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Filter messages" className={cn(inputClass, "h-8 pl-9 text-xs")} />
        </div>
      </div>
      {logs.length === 0 ? (
        <EmptyNote>No log entries.</EmptyNote>
      ) : (
        <div className="max-h-[65vh] space-y-1 overflow-y-auto rounded-lg border border-line bg-inset p-3 font-mono text-[11px] leading-relaxed scrollbar-thin">
          {logs.map((l) => (
            <p key={l.id} className="flex gap-2">
              <span className="shrink-0 text-subtle">{new Date(l.ts).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", second: "2-digit" })}</span>
              <span className={cn("w-10 shrink-0 font-semibold uppercase", l.priority <= 3 ? "text-crit" : l.priority === 4 ? "text-warn" : "text-info")}>{PRIO[l.priority] ?? l.priority}</span>
              <span className="w-28 shrink-0 truncate text-primary-fg">{l.server}</span>
              <span className="w-36 shrink-0 truncate text-muted">{l.unit}</span>
              <span className="min-w-0 break-words">{l.message}</span>
            </p>
          ))}
        </div>
      )}
    </Card>
  );
}

function AuditTab() {
  const { data, error } = useApi<{ entries: { id: string; ts: number; user_name: string; action: string; target: string; detail: string }[] }>("/api/audit", { interval: 30_000 });
  if (error && !data) return <EmptyNote>{error.message}</EmptyNote>;
  return (
    <Card>
      <CardHeader icon={History} title="Audit log" subtitle="Who did what, most recent first" />
      {!data?.entries.length ? (
        <EmptyNote>No entries yet.</EmptyNote>
      ) : (
        <ul className="divide-y divide-line text-sm">
          {data.entries.map((e) => (
            <li key={e.id} className="flex flex-col gap-0.5 py-2 sm:flex-row sm:items-baseline sm:gap-3">
              <span className="w-40 shrink-0 text-xs text-subtle">{dateTime(e.ts)}</span>
              <span className="w-32 shrink-0 font-medium">{e.user_name}</span>
              <span className="font-mono text-xs text-primary-fg">{e.action}</span>
              <span className="min-w-0 flex-1 truncate text-muted">
                {e.target}
                {e.detail && <span className="text-subtle"> — {e.detail}</span>}
              </span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
