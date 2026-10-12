"use client";

import { CalendarClock, Download, History, Pencil, Power, RefreshCw, ShieldAlert, ShieldCheck, Timer } from "lucide-react";
import { useState } from "react";
import { Modal, useConfirm, useToast } from "@/components/providers";
import { Badge, Button, Card, CardHeader, cn, EmptyNote, EnvBadge, Field, inputClass, PageHeader, Segmented, StatusBadge, Table, Toggle, type Env } from "@/components/ui";
import { ago, api, dateTime, useApi, useMe } from "@/lib/client";

type Policy = { id: string; name: string; environment: string; enabled: boolean; scope: "security" | "all"; days: string[]; start: string; duration_minutes: number; timezone: string; interval_hours: number; auto_reboot: boolean; exclude: string[]; servers: number };
type Pkg = { name: string; available: string; current: string[]; security: boolean; advisory: string | null; manager: string; servers: { id: string; name: string; current: string }[] };
type Run = { id: string; server: string; server_id: string; trigger: string; started_at: number; status: string; packages: string[]; error: string | null; reboot_scheduled: number };
type Data = {
  kpis: { pending: number; security: number; rebootRequired: { id: string; name: string }[]; lastCheck: number; lastRun: (Run & { server: string }) | null };
  packages: Pkg[];
  servers: { id: string; name: string; environment: string; status: string; updates: number; security: number; rebootRequired: boolean; error: string | null; packageManager: string }[];
  policies: Policy[];
  runs: Run[];
};

const DAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];

export function UpdatesView() {
  const { can } = useMe();
  const { toast } = useToast();
  const confirm = useConfirm();
  const { data, error, reload } = useApi<Data>("/api/updates", { interval: 15_000 });
  const [kind, setKind] = useState<"all" | "security" | "other">("all");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [editing, setEditing] = useState<Policy | null>(null);

  if (error && !data) return <EmptyNote>Couldn&apos;t load updates: {error.message}</EmptyNote>;
  if (!data) return <p className="text-sm text-muted">Loading…</p>;

  const rows = data.packages.filter((p) => kind === "all" || (kind === "security" ? p.security : !p.security));
  const allSelected = rows.length > 0 && rows.every((r) => selected.has(r.name));

  async function bulk(path: "apply" | "check", body: Record<string, unknown>, what: string) {
    try {
      const r = await api<{ queued: number }>(`/api/updates/${path}`, { body });
      toast({ title: what, body: `Sent to ${r.queued} server(s). Each agent picks it up on its next report; progress appears in the run history.`, tone: "success" });
      setSelected(new Set());
      reload();
    } catch (err) {
      toast({ title: `Couldn't start: ${what.toLowerCase()}`, body: (err as Error).message, tone: "error" });
    }
  }

  async function applySecurity() {
    if (await confirm({ title: `Install ${data!.kpis.security} security updates?`, body: "Every server with pending security updates installs them now, regardless of its maintenance window.", confirmLabel: "Install now" }))
      bulk("apply", { serverIds: "all", securityOnly: true }, "Security updates started");
  }

  async function applySelected() {
    const pkgs = [...selected];
    const servers = new Set(data!.packages.filter((p) => selected.has(p.name)).flatMap((p) => p.servers.map((s) => s.id)));
    if (await confirm({ title: `Install ${pkgs.length} package${pkgs.length === 1 ? "" : "s"} on ${servers.size} server${servers.size === 1 ? "" : "s"}?`, body: <span className="font-mono text-xs">{pkgs.slice(0, 12).join(", ")}{pkgs.length > 12 ? ` +${pkgs.length - 12}` : ""}</span>, confirmLabel: "Install" }))
      bulk("apply", { serverIds: [...servers], packages: pkgs }, "Package install started");
  }

  async function savePolicy(p: Policy, patch: Partial<Policy>) {
    const next = { ...p, ...patch };
    try {
      await api(`/api/policies/${p.id}`, {
        method: "PUT",
        body: { enabled: next.enabled, scope: next.scope, mode: next.interval_hours && !next.start ? "interval" : "window", days: next.days, start: next.start, durationMinutes: next.duration_minutes, timezone: next.timezone, intervalHours: next.interval_hours, autoReboot: next.auto_reboot, exclude: next.exclude },
      });
      toast({ title: `${p.name} policy saved`, body: "Agents receive it on their next report.", tone: "success" });
      reload();
      return true;
    } catch (err) {
      toast({ title: "Couldn't save policy", body: (err as Error).message, tone: "error" });
      return false;
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Updates"
        description="Pending package updates across apt, dnf, apk and pacman hosts, and the auto-update policy for each environment."
        actions={
          can("updates.run") && (
            <>
              <Button icon={RefreshCw} onClick={() => bulk("check", { serverIds: "all" }, "Update check started")}>
                Check all servers
              </Button>
              {data.kpis.security > 0 && (
                <Button variant="primary" icon={Download} onClick={applySecurity}>
                  Install security updates
                </Button>
              )}
            </>
          )
        }
      />

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Kpi label="Pending packages" value={data.kpis.pending} sub={`across ${data.servers.filter((s) => s.updates).length} server(s)`} icon={Download} />
        <Kpi label="Security updates" value={data.kpis.security} sub="flagged by the distribution" icon={ShieldAlert} tone={data.kpis.security ? "warn" : undefined} />
        <Kpi label="Reboot required" value={data.kpis.rebootRequired.length} sub={data.kpis.rebootRequired.map((s) => s.name).join(", ") || "none"} icon={Power} tone={data.kpis.rebootRequired.length ? "info" : undefined} />
        <Kpi label="Last check" value={data.kpis.lastCheck ? ago(data.kpis.lastCheck) : "—"} sub={data.kpis.lastRun ? `Last run: ${data.kpis.lastRun.server}, ${data.kpis.lastRun.status}` : "No update runs yet"} icon={Timer} />
      </div>

      <div>
        <div className="mb-3">
          <h2 className="text-sm font-semibold">Auto-update policies</h2>
          <p className="text-xs text-subtle">Each server runs its environment&apos;s policy itself, so updates still happen if the dashboard is unreachable.</p>
        </div>
        <div className="grid gap-4 lg:grid-cols-3">
          {data.policies.map((p) => (
            <Card key={p.id} className={cn("p-4", !p.enabled && "opacity-80")}>
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2">
                    <p className="font-semibold">{p.name}</p>
                    <EnvBadge env={p.environment as Env} />
                  </div>
                  <p className="mt-0.5 text-xs text-subtle">
                    {p.servers} server{p.servers === 1 ? "" : "s"}
                  </p>
                </div>
                {can("updates.policy") && <Toggle key={`${p.id}-${p.enabled}`} label={`Enable ${p.name} policy`} defaultChecked={p.enabled} onChange={(v) => savePolicy(p, { enabled: v })} />}
              </div>
              <dl className="mt-4 space-y-2 text-xs">
                {[
                  ["Updates", p.scope === "security" ? "Security only" : "All"],
                  ["When", p.interval_hours && !p.start ? `Every ${p.interval_hours} hours` : `${p.days.length ? p.days.join(", ") : "Every day"} ${p.start}–${endTime(p.start, p.duration_minutes)} ${p.timezone}`],
                  ["Reboot", p.auto_reboot ? "Automatically if required" : "Manual"],
                  ["Excluded", p.exclude.length ? p.exclude.join(", ") : "None"],
                ].map(([k, v]) => (
                  <div key={k} className="flex justify-between gap-3">
                    <dt className="text-subtle">{k}</dt>
                    <dd className="text-right font-medium">{v}</dd>
                  </div>
                ))}
              </dl>
              {can("updates.policy") && (
                <div className="mt-4 border-t border-line pt-3">
                  <Button size="sm" variant="ghost" icon={Pencil} onClick={() => setEditing(p)}>
                    Edit
                  </Button>
                </div>
              )}
            </Card>
          ))}
        </div>
      </div>

      <div className="grid gap-4 xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-sm font-semibold">Pending packages</h2>
              <p className="text-xs text-subtle">Security updates are listed first</p>
            </div>
            <Segmented size="sm" value={kind} onChange={setKind} options={[{ value: "all", label: "All", count: data.packages.length }, { value: "security", label: "Security", count: data.packages.filter((p) => p.security).length }, { value: "other", label: "Other" }]} />
          </div>

          {selected.size > 0 && can("updates.run") && (
            <div className="mb-3 flex items-center justify-between rounded-lg border border-primary/30 bg-primary-soft px-3 py-2 text-sm">
              <span>
                <span className="font-semibold">{selected.size}</span> selected
              </span>
              <div className="flex gap-2">
                <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>
                  Clear
                </Button>
                <Button size="sm" variant="primary" icon={Download} onClick={applySelected}>
                  Install selected
                </Button>
              </div>
            </div>
          )}

          {rows.length === 0 ? (
            <EmptyNote>{data.packages.length === 0 ? "Every server is up to date." : "Nothing in this filter."}</EmptyNote>
          ) : (
            <Table>
              <thead>
                <tr>
                  {can("updates.run") && (
                    <th className="w-8">
                      <input type="checkbox" aria-label="Select all" checked={allSelected} onChange={() => setSelected(allSelected ? new Set() : new Set(rows.map((r) => r.name)))} className="accent-[var(--primary)]" />
                    </th>
                  )}
                  <th>Package</th>
                  <th>Version</th>
                  <th>Type</th>
                  <th>Servers</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((u) => (
                  <tr key={`${u.name}@${u.available}`} className={cn(selected.has(u.name) && "bg-primary-soft")}>
                    {can("updates.run") && (
                      <td>
                        <input
                          type="checkbox"
                          aria-label={`Select ${u.name}`}
                          checked={selected.has(u.name)}
                          onChange={() =>
                            setSelected((s) => {
                              const n = new Set(s);
                              if (n.has(u.name)) n.delete(u.name);
                              else n.add(u.name);
                              return n;
                            })
                          }
                          className="accent-[var(--primary)]"
                        />
                      </td>
                    )}
                    <td>
                      <div className="flex items-center gap-2">
                        <p className="font-mono text-xs font-medium whitespace-nowrap">{u.name}</p>
                        <Badge className="font-mono">{u.manager}</Badge>
                      </div>
                      {u.advisory && <p className="mt-0.5 font-mono text-[11px] text-warn">{u.advisory}</p>}
                    </td>
                    <td className="font-mono text-[11px] whitespace-nowrap">
                      <span className="text-subtle">{u.current.length > 1 ? `${u.current.length} versions` : u.current[0] ?? "?"}</span>
                      <span className="mx-1 text-subtle">→</span>
                      <span className="text-fg">{u.available}</span>
                    </td>
                    <td>
                      {u.security ? (
                        <Badge tone="warn" icon={ShieldAlert}>
                          security
                        </Badge>
                      ) : (
                        <Badge>update</Badge>
                      )}
                    </td>
                    <td className="text-xs whitespace-nowrap text-muted" title={u.servers.map((s) => s.name).join(", ")}>
                      {u.servers.length <= 2 ? u.servers.map((s) => s.name).join(", ") : `${u.servers[0].name} +${u.servers.length - 1}`}
                    </td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </Card>

        <Card>
          <CardHeader icon={History} title="Run history" />
          {data.runs.length === 0 ? (
            <EmptyNote>No update runs yet. They appear here when a policy window runs or you install updates.</EmptyNote>
          ) : (
            <ol className="space-y-3">
              {data.runs.map((r) => (
                <li key={r.id} className={cn("rounded-lg border p-3", r.status === "failed" ? "border-crit/30 bg-crit/[0.06]" : r.status === "skipped" ? "border-warn/30 bg-warn/[0.05]" : "border-line bg-inset")}>
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-sm font-medium">{r.server}</p>
                    <StatusBadge status={r.status === "skipped" ? "partial" : r.status} label={r.status} />
                  </div>
                  <p className="tabular mt-1 text-xs text-muted">
                    {dateTime(r.started_at)} · {r.trigger === "schedule" ? "scheduled" : "manual"} · {r.packages.length} package{r.packages.length === 1 ? "" : "s"}
                    {r.reboot_scheduled ? " · reboot scheduled" : ""}
                  </p>
                  {r.error && <p className="mt-1.5 text-[11px] text-muted">{r.error}</p>}
                </li>
              ))}
            </ol>
          )}
        </Card>
      </div>

      <Card className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center">
        <ShieldCheck className="size-5 shrink-0 text-ok" />
        <p className="flex-1 text-sm text-muted">
          <span className="font-medium text-fg">Pre-flight checks</span> run on the server before every update: free disk space on /, /var and /boot (set by the agent&apos;s <code className="font-mono text-xs">min_free_disk_percent</code>), and only one package operation at a time. Runs that fail a check are recorded as skipped.
        </p>
      </Card>

      {editing && <PolicyEditor policy={editing} onClose={() => setEditing(null)} onSave={async (patch) => (await savePolicy(editing, patch)) && setEditing(null)} />}
    </div>
  );
}

function endTime(start: string, minutes: number) {
  const [h, m] = start.split(":").map(Number);
  const t = (h * 60 + m + minutes) % 1440;
  return `${String(Math.floor(t / 60)).padStart(2, "0")}:${String(t % 60).padStart(2, "0")}`;
}

function Kpi({ label, value, sub, icon: Icon, tone }: { label: string; value: React.ReactNode; sub: string; icon: typeof Download; tone?: "warn" | "info" }) {
  return (
    <div className={cn("glass relative overflow-hidden p-4", tone === "warn" && "border-warn/30")}>
      {tone === "warn" && <span className="absolute inset-x-0 top-0 h-0.5 bg-warn" />}
      <div className="flex items-center justify-between">
        <p className="text-xs font-medium text-muted">{label}</p>
        <Icon className={cn("size-4", tone === "warn" ? "text-warn" : tone === "info" ? "text-info" : "text-subtle")} />
      </div>
      <p className="tabular mt-2 text-[28px] leading-none font-semibold tracking-tight">{value}</p>
      <p className="mt-2 truncate text-xs text-subtle">{sub}</p>
    </div>
  );
}

function PolicyEditor({ policy, onClose, onSave }: { policy: Policy; onClose: () => void; onSave: (p: Partial<Policy>) => void }) {
  const [mode, setMode] = useState<"window" | "interval">(policy.interval_hours && !policy.start ? "interval" : "window");
  const [f, setF] = useState({ ...policy, start: policy.start || "02:00", interval_hours: policy.interval_hours || 6 });
  const [exclude, setExclude] = useState(policy.exclude.join(", "));
  const zones = typeof Intl.supportedValuesOf === "function" ? Intl.supportedValuesOf("timeZone") : ["UTC"];
  return (
    <Modal title={`${policy.name} update policy`} onClose={onClose} icon={CalendarClock} wide>
      <form
        className="space-y-5"
        onSubmit={(e) => {
          e.preventDefault();
          onSave({
            ...f,
            start: mode === "window" ? f.start : "",
            interval_hours: mode === "interval" ? f.interval_hours : 0,
            exclude: exclude.split(/[\s,]+/).filter(Boolean),
          });
        }}
      >
        <div className="flex items-center justify-between rounded-lg border border-line bg-inset p-3">
          <div>
            <p className="text-sm font-medium">Automatic updates</p>
            <p className="text-xs text-subtle">When off, updates only run when started from the dashboard.</p>
          </div>
          <Toggle label="Enabled" defaultChecked={f.enabled} onChange={(v) => setF({ ...f, enabled: v })} />
        </div>

        <Field label="What to install">
          <Segmented value={f.scope} onChange={(v) => setF({ ...f, scope: v })} options={[{ value: "security", label: "Security updates only" }, { value: "all", label: "All updates" }]} />
        </Field>

        <Field label="When">
          <Segmented value={mode} onChange={setMode} options={[{ value: "window", label: "Maintenance window" }, { value: "interval", label: "Every few hours" }]} />
        </Field>

        {mode === "window" ? (
          <div className="space-y-4">
            <Field label="Days" hint="None selected means every day.">
              <div className="flex flex-wrap gap-1.5">
                {DAYS.map((d) => (
                  <button
                    type="button"
                    key={d}
                    onClick={() => setF({ ...f, days: f.days.includes(d) ? f.days.filter((x) => x !== d) : [...f.days, d] })}
                    className={cn("rounded-md px-2.5 py-1 text-xs font-medium capitalize ring-1 ring-inset", f.days.includes(d) ? "bg-primary-soft text-primary-fg ring-primary/40" : "text-muted ring-line-strong hover:text-fg")}
                  >
                    {d}
                  </button>
                ))}
              </div>
            </Field>
            <div className="grid gap-4 sm:grid-cols-3">
              <Field label="Start">
                <input type="time" className={inputClass} value={f.start} onChange={(e) => setF({ ...f, start: e.target.value })} required />
              </Field>
              <Field label="Length (minutes)">
                <input type="number" min={15} max={1440} className={inputClass} value={f.duration_minutes} onChange={(e) => setF({ ...f, duration_minutes: Number(e.target.value) })} />
              </Field>
              <Field label="Timezone">
                <select className={inputClass} value={f.timezone} onChange={(e) => setF({ ...f, timezone: e.target.value })}>
                  {(zones.includes("UTC") ? zones : ["UTC", ...zones]).map((z) => (
                    <option key={z}>{z}</option>
                  ))}
                </select>
              </Field>
            </div>
          </div>
        ) : (
          <Field label="Run every (hours)">
            <input type="number" min={1} max={168} className={inputClass} value={f.interval_hours} onChange={(e) => setF({ ...f, interval_hours: Number(e.target.value) })} />
          </Field>
        )}

        <div className="flex items-center justify-between rounded-lg border border-line bg-inset p-3">
          <div>
            <p className="text-sm font-medium">Reboot automatically when required</p>
            <p className="text-xs text-subtle">Only on servers whose agent config allows reboots (actions.reboot).</p>
          </div>
          <Toggle label="Auto reboot" defaultChecked={f.auto_reboot} onChange={(v) => setF({ ...f, auto_reboot: v })} />
        </div>

        <Field label="Never update automatically" hint="Package names, comma-separated (e.g. docker-ce, postgresql-16)">
          <input className={cn(inputClass, "font-mono text-xs")} value={exclude} onChange={(e) => setExclude(e.target.value)} />
        </Field>

        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" type="submit">
            Save policy
          </Button>
        </div>
      </form>
    </Modal>
  );
}
