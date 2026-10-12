"use client";

import { ChevronDown, Download, ExternalLink, EyeOff, Info, RefreshCw, Search, ShieldAlert, ShieldCheck, Undo2 } from "lucide-react";
import { useState } from "react";
import { Modal, useConfirm, useToast } from "@/components/providers";
import { Badge, Button, Card, CardHeader, cn, EmptyNote, Field, inputClass, PageHeader, Segmented, Toggle, type Tone } from "@/components/ui";
import { ago, api, useApi, useMe, useStartUpdateJob } from "@/lib/client";

type Sev = "critical" | "high" | "medium" | "low" | "unknown";
type Affected = { id: string; serverId: string; server: string; environment: string; installed: string; fixed: string | null; binaries: string; status: string; ignoredReason: string | null };
type Vuln = { key: string; vulnId: string; package: string; severity: Sev; score: number | null; summary: string; url: string; origin: string; aliases: string[]; fixed: string | null; firstSeen: number; affected: Affected[] };
type Data = {
  kpis: { critical: number; high: number; medium: number; other: number; affectedServers: number };
  vulnerabilities: Vuln[];
  coverage: { id: string; name: string; ecosystem: string | null; scannedAt: number | null; error: string | null }[];
  lastScanAt: number | null;
  lastError: string | null;
  enabled: boolean;
};

const tone: Record<Sev, Tone> = { critical: "crit", high: "warn", medium: "info", low: "neutral", unknown: "neutral" };

export function VulnerabilitiesView() {
  const { can } = useMe();
  const { toast } = useToast();
  const confirm = useConfirm();
  const startJob = useStartUpdateJob();
  const [showFixed, setShowFixed] = useState(false);
  const [sev, setSev] = useState<"all" | Sev>("all");
  const [q, setQ] = useState("");
  const [open, setOpen] = useState<string | null>(null);
  const [ignoring, setIgnoring] = useState<Vuln | null>(null);
  const [limit, setLimit] = useState(50);
  const { data, error, reload } = useApi<Data>(`/api/vulnerabilities${showFixed ? "?fixed=1" : ""}`, { interval: 20_000 });

  if (error && !data) return <EmptyNote>Couldn&apos;t load vulnerabilities: {error.message}</EmptyNote>;
  if (!data) return <p className="text-sm text-muted">Loading…</p>;

  const list = data.vulnerabilities.filter(
    (v) => (sev === "all" || v.severity === sev || (sev === "low" && v.severity === "unknown")) && (q === "" || `${v.vulnId} ${v.package} ${v.summary} ${v.aliases.join(" ")} ${v.affected.map((a) => a.server).join(" ")}`.toLowerCase().includes(q.toLowerCase())),
  );

  async function scan() {
    try {
      await api("/api/vulnerabilities/scan", { body: {} });
      toast({ title: "Scan started", body: "Pending packages on every server are being checked against OSV.dev. Results appear in a minute or so.", tone: "success" });
      setTimeout(reload, 8000);
    } catch (err) {
      toast({ title: "Couldn't start scan", body: (err as Error).message, tone: "error" });
    }
  }

  async function installFix(v: Vuln) {
    const targets = v.affected.filter((a) => a.status === "open");
    const packages = [...new Set(targets.flatMap((a) => a.binaries.split(", ")))].filter(Boolean);
    if (!(await confirm({ title: `Install the fix for ${v.vulnId}?`, body: <>Upgrades <span className="font-mono text-fg">{packages.join(", ")}</span> on {targets.length} server{targets.length === 1 ? "" : "s"} now.</>, confirmLabel: "Install fix" }))) return;
    await startJob({ serverIds: [...new Set(targets.map((a) => a.serverId))], packages });
  }

  async function setStatus(ids: string[], status: "ignored" | "open", reason = "") {
    try {
      await api("/api/vulnerabilities", { method: "PATCH", body: { ids, status, reason } });
      toast({ title: status === "ignored" ? "Marked as ignored" : "Re-opened", tone: "success" });
      reload();
    } catch (err) {
      toast({ title: "Couldn't update", body: (err as Error).message, tone: "error" });
    }
  }

  const unsupported = data.coverage.filter((c) => !c.ecosystem);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Vulnerabilities"
        description="Known CVEs in packages that have pending updates, from OSV.dev and your distributions' security advisories."
        actions={
          can("updates.run") && (
            <Button icon={RefreshCw} onClick={scan}>
              Scan now
            </Button>
          )
        }
      />

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
        {(
          [
            ["critical", "Critical", data.kpis.critical, "CVSS 9.0–10"],
            ["high", "High", data.kpis.high, "CVSS 7.0–8.9"],
            ["medium", "Medium", data.kpis.medium, "CVSS 4.0–6.9"],
            ["low", "Low / unrated", data.kpis.other, "including distro advisories"],
          ] as const
        ).map(([k, label, n, sub]) => (
          <button key={k} onClick={() => setSev(sev === k ? "all" : k)} className={cn("glass relative overflow-hidden p-4 text-left transition-colors hover:bg-glass-hover", sev === k && "ring-1 ring-primary/40", k === "critical" && n > 0 && "border-crit/40")}>
            {k === "critical" && n > 0 && <span className="absolute inset-x-0 top-0 h-0.5 bg-crit" />}
            <p className="text-xs font-medium text-muted">{label}</p>
            <p className={cn("tabular mt-2 text-[28px] leading-none font-semibold", k === "critical" && n > 0 && "text-crit", k === "high" && n > 0 && "text-warn")}>{n}</p>
            <p className="mt-2 text-xs text-subtle">{sub}</p>
          </button>
        ))}
        <div className="glass col-span-2 p-4 lg:col-span-1">
          <p className="text-xs font-medium text-muted">Servers affected</p>
          <p className="tabular mt-2 text-[28px] leading-none font-semibold">{data.kpis.affectedServers}</p>
          <p className="mt-2 text-xs text-subtle">{data.lastScanAt ? `Last scan ${ago(data.lastScanAt)}` : data.enabled ? "Waiting for first scan" : "Automatic scans are off"}</p>
        </div>
      </div>

      {(data.lastError || unsupported.length > 0) && (
        <div className="glass flex gap-3 p-4 text-sm">
          <Info className="mt-0.5 size-4 shrink-0 text-info" />
          <div className="space-y-1 text-muted">
            {data.lastError && <p className="text-warn">Last scan reported an error: {data.lastError}</p>}
            {unsupported.length > 0 && (
              <p>
                OSV has no data for {unsupported.map((c) => c.name).join(", ")}. For these servers only packages the distribution flags as security updates are listed (CVE data is available for Debian, Ubuntu, Alpine, Rocky and AlmaLinux).
              </p>
            )}
          </div>
        </div>
      )}

      <Card>
        <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center">
          <Segmented size="sm" value={sev} onChange={setSev} options={[{ value: "all", label: "All" }, { value: "critical", label: "Critical" }, { value: "high", label: "High" }, { value: "medium", label: "Medium" }, { value: "low", label: "Low" }]} />
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-subtle" />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search CVE, package or server" className={cn(inputClass, "h-8 pl-9 text-xs")} />
          </div>
          <label className="flex items-center gap-2 text-xs text-muted">
            <Toggle label="Show fixed" defaultChecked={showFixed} onChange={setShowFixed} />
            Fixed
          </label>
        </div>

        {list.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-10 text-center">
            <ShieldCheck className="size-8 text-ok" />
            <p className="font-medium">{data.vulnerabilities.length ? "Nothing matches these filters" : "No known vulnerabilities"}</p>
            <p className="max-w-md text-sm text-subtle">Pending packages are checked automatically whenever a server reports new updates, and on a schedule (Settings).</p>
          </div>
        ) : (
          <>
          <ul className="divide-y divide-line">
            {list.slice(0, limit).map((v) => {
              const openRows = v.affected.filter((a) => a.status === "open");
              const allIgnored = v.affected.every((a) => a.status === "ignored");
              const allFixed = v.affected.every((a) => a.status === "fixed");
              const expanded = open === v.key;
              return (
                <li key={v.key} className={cn("py-3", (allIgnored || allFixed) && "opacity-60")}>
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start">
                    <button onClick={() => setOpen(expanded ? null : v.key)} className="flex min-w-0 flex-1 items-start gap-3 text-left">
                      <span className="w-20 shrink-0">
                        <Badge tone={tone[v.severity]} icon={v.severity === "critical" || v.severity === "high" ? ShieldAlert : undefined}>
                          {v.score ? v.score.toFixed(1) : v.severity}
                        </Badge>
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                          <span className="font-mono text-sm font-semibold">{v.vulnId}</span>
                          <span className="text-sm text-muted">in</span>
                          <span className="font-mono text-sm">{v.package}</span>
                          {v.origin === "package-manager" && <Badge>distro advisory</Badge>}
                          {allIgnored && <Badge>ignored</Badge>}
                          {allFixed && <Badge tone="ok">fixed</Badge>}
                        </span>
                        <span className="mt-0.5 block truncate text-xs text-subtle">{v.summary}</span>
                        <span className="mt-1 block text-xs text-muted">
                          {v.affected.length} server{v.affected.length === 1 ? "" : "s"}
                          {v.fixed ? <> · fixed in <span className="font-mono">{v.fixed}</span></> : v.affected.length > 1 ? " · fix versions vary by distro" : ""} · first seen {ago(v.firstSeen)}
                        </span>
                      </span>
                      <ChevronDown className={cn("mt-1 size-4 shrink-0 text-subtle transition-transform", expanded && "rotate-180")} />
                    </button>
                    <div className="flex shrink-0 gap-2 sm:pl-2">
                      {v.url && (
                        <a href={v.url} target="_blank" rel="noreferrer">
                          <Button size="sm" variant="ghost" icon={ExternalLink}>
                            Details
                          </Button>
                        </a>
                      )}
                      {can("alerts.ack") && !allFixed && (allIgnored ? (
                        <Button size="sm" variant="ghost" icon={Undo2} onClick={() => setStatus(v.affected.filter((a) => a.status === "ignored").map((a) => a.id), "open")}>
                          Re-open
                        </Button>
                      ) : (
                        <Button size="sm" variant="ghost" icon={EyeOff} onClick={() => setIgnoring(v)}>
                          Ignore
                        </Button>
                      ))}
                      {can("updates.run") && openRows.length > 0 && (
                        <Button size="sm" variant="primary" icon={Download} onClick={() => installFix(v)}>
                          Install fix
                        </Button>
                      )}
                    </div>
                  </div>
                  {expanded && (
                    <div className="mt-3 ml-0 rounded-lg border border-line bg-inset p-3 sm:ml-23">
                      {v.aliases.length > 0 && <p className="mb-2 text-xs text-subtle">Also known as: <span className="font-mono">{v.aliases.join(", ")}</span></p>}
                      <table className="w-full text-xs">
                        <thead className="text-left text-[11px] text-subtle uppercase">
                          <tr>
                            <th className="pb-1 font-medium">Server</th>
                            <th className="pb-1 font-medium">Packages</th>
                            <th className="pb-1 font-medium">Installed</th>
                            <th className="pb-1 font-medium">Fixed in</th>
                            <th className="pb-1 font-medium">Status</th>
                          </tr>
                        </thead>
                        <tbody>
                          {v.affected.map((a) => (
                            <tr key={a.id} className="border-t border-line">
                              <td className="py-1.5 font-medium">{a.server}</td>
                              <td className="py-1.5 font-mono text-muted">{a.binaries}</td>
                              <td className="py-1.5 font-mono text-muted">{a.installed}</td>
                              <td className="py-1.5 font-mono text-muted">{a.fixed ?? "—"}</td>
                              <td className="py-1.5">
                                {a.status}
                                {a.ignoredReason && <span className="text-subtle"> — {a.ignoredReason}</span>}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
          {list.length > limit && (
            <div className="mt-3 flex items-center justify-center gap-3 border-t border-line pt-4 text-xs text-subtle">
              Showing {limit} of {list.length}
              <Button size="sm" onClick={() => setLimit(limit + 50)}>
                Show 50 more
              </Button>
            </div>
          )}
          </>
        )}
      </Card>

      <Card>
        <CardHeader icon={ShieldCheck} title="Scan coverage" subtitle="CVE data source per server" />
        {data.coverage.length === 0 ? (
          <EmptyNote>No servers yet.</EmptyNote>
        ) : (
          <ul className="grid gap-2 text-xs sm:grid-cols-2 xl:grid-cols-3">
            {data.coverage.map((c) => (
              <li key={c.id} className="flex items-center gap-2 rounded-lg border border-line bg-inset p-2.5">
                <span className={cn("size-2 shrink-0 rounded-full", c.ecosystem ? "bg-ok" : "bg-warn")} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">{c.name}</span>
                  <span className="block truncate text-subtle">{c.ecosystem ? `OSV · ${c.ecosystem}` : "Distro advisories only"}{c.scannedAt ? ` · scanned ${ago(c.scannedAt)}` : " · not scanned yet"}</span>
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {ignoring && (
        <IgnoreDialog
          vuln={ignoring}
          onClose={() => setIgnoring(null)}
          onConfirm={(reason) => {
            setStatus(ignoring.affected.filter((a) => a.status === "open").map((a) => a.id), "ignored", reason);
            setIgnoring(null);
          }}
        />
      )}
    </div>
  );
}

function IgnoreDialog({ vuln, onClose, onConfirm }: { vuln: Vuln; onClose: () => void; onConfirm: (reason: string) => void }) {
  const [reason, setReason] = useState("");
  return (
    <Modal title={`Ignore ${vuln.vulnId}?`} onClose={onClose} icon={EyeOff}>
      <p className="text-sm text-muted">It stops counting towards alerts on {vuln.affected.length} server(s). It reappears if you re-open it.</p>
      <div className="mt-4">
        <Field label="Reason (recorded in the audit log)">
          <input className={inputClass} autoFocus placeholder="e.g. not exposed: service isn't internet-facing" value={reason} onChange={(e) => setReason(e.target.value)} />
        </Field>
      </div>
      <div className="mt-6 flex justify-end gap-2">
        <Button variant="ghost" onClick={onClose}>
          Cancel
        </Button>
        <Button variant="primary" onClick={() => onConfirm(reason)}>
          Ignore
        </Button>
      </div>
    </Modal>
  );
}
