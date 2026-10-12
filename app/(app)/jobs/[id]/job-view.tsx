"use client";

import { ArrowDownToLine, ArrowLeft, Check, PackageCheck, Server, Terminal } from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { elapsed, JobProgress, JobStatusBadge, TriggerBadge, type JobStatus } from "@/components/jobs";
import { Badge, Card, CardHeader, cn, EmptyNote, PageHeader, Toggle } from "@/components/ui";
import { api, dateTime, useApi, useNow } from "@/lib/client";

type Target = {
  id: string;
  serverId: string;
  server: string;
  status: JobStatus;
  phase: string;
  total: number;
  done: number;
  installed: { name: string; version?: string; t: number }[];
  logLines: number;
  startedAt: number | null;
  finishedAt: number | null;
  error: string | null;
};
type Job = {
  id: string;
  kind: string;
  label: string;
  trigger: string;
  status: JobStatus;
  createdBy: string;
  createdAt: number;
  startedAt: number | null;
  finishedAt: number | null;
  args: { packages?: string[]; security_only?: boolean; version?: string };
  servers: { total: number; succeeded: number; failed: number; running: number };
  packages: { installed: number; total: number };
  targets: Target[];
};
type Line = { seq: number; ts: number; stream: string; text: string };

const UPDATE_PHASES = [
  { id: "preflight", label: "Pre-flight" },
  { id: "refreshing", label: "Refresh lists" },
  { id: "installing", label: "Install" },
  { id: "verifying", label: "Verify" },
  { id: "done", label: "Done" },
];
const AGENT_PHASES = [
  { id: "downloading", label: "Download" },
  { id: "verifying", label: "Verify" },
  { id: "installing", label: "Install" },
  { id: "restarting", label: "Restart" },
  { id: "done", label: "Confirmed" },
];
const phasesFor = (kind: string) => (kind === "agent.update" ? AGENT_PHASES : UPDATE_PHASES);
const MAX_RENDERED = 4000;
const active = (s: JobStatus) => s === "running" || s === "queued";

/** Incrementally fetch a target's log while it runs (one request per second). */
function useJobLogs(jobId: string, targetId: string | null) {
  const key = `${jobId}:${targetId}`;
  const [state, setState] = useState<{ key: string; lines: Line[]; finished: boolean }>({ key: "", lines: [], finished: false });
  useEffect(() => {
    if (!targetId) return;
    let cancelled = false;
    let after = -1;
    let lines: Line[] = [];
    let timer: ReturnType<typeof setTimeout> | undefined;
    const poll = async () => {
      try {
        const r = await api<{ lines: Line[]; finished: boolean }>(`/api/jobs/${jobId}/logs?target=${targetId}&after=${after}`);
        if (cancelled) return;
        if (r.lines.length) {
          lines = lines.concat(r.lines);
          after = r.lines[r.lines.length - 1].seq;
        }
        setState({ key, lines, finished: r.finished });
        const backlog = r.lines.length >= 2000;
        if (!r.finished || backlog) timer = setTimeout(poll, backlog ? 0 : 1000);
      } catch {
        if (!cancelled) timer = setTimeout(poll, 3000);
      }
    };
    poll();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [jobId, targetId, key]);
  return state.key === key ? state : { lines: [] as Line[], finished: false };
}

export function JobView() {
  const { id } = useParams<{ id: string }>();
  const [picked, setPicked] = useState<string | null>(null);
  const [polling, setPolling] = useState(true);
  const { data: job, error } = useApi<Job>(`/api/jobs/${id}`, { interval: polling ? 1000 : false });
  const now = useNow(1000);

  // Stop polling the summary once everything has finished.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (job) setPolling(active(job.status));
  }, [job]);

  if (error && !job) return <EmptyNote>Couldn&apos;t load this job: {error.message}</EmptyNote>;
  if (!job) return <p className="text-sm text-muted">Loading…</p>;

  const PHASES = phasesFor(job.kind);
  const isAgent = job.kind === "agent.update";
  const target = job.targets.find((t) => t.id === picked) ?? job.targets.find((t) => t.status === "running") ?? job.targets[0];
  const scope = job.kind === "agent.update"
    ? `agent version ${job.args.version ?? ""}`
    : job.args.packages?.length ? job.args.packages.join(", ") : job.args.security_only ? "security updates only" : job.trigger === "schedule" ? "per the auto-update policy" : "all pending updates";

  return (
    <div className="space-y-6">
      <Link href="/jobs" className="inline-flex items-center gap-1.5 text-xs font-medium text-muted hover:text-fg">
        <ArrowLeft className="size-3.5" /> All jobs
      </Link>
      <PageHeader
        title={job.label}
        description={`${job.trigger === "schedule" ? "Started by the auto-update policy" : `Started by ${job.createdBy}`} · ${dateTime(job.createdAt)} · ${scope}`}
        actions={
          <div className="flex items-center gap-2">
            <TriggerBadge trigger={job.trigger} />
            <JobStatusBadge status={job.status} />
          </div>
        }
      />

      <Card>
        <div className="grid gap-4 sm:grid-cols-4">
          {isAgent ? (
            <Stat label="Agents updated" value={`${job.servers.succeeded} / ${job.servers.total}`} />
          ) : (
            <Stat label="Packages installed" value={`${job.packages.installed}${job.packages.total ? ` / ${job.packages.total}` : ""}`} />
          )}
          <Stat label="Servers finished" value={`${job.servers.succeeded + job.servers.failed} / ${job.servers.total}`} />
          <Stat label="Failed" value={String(job.servers.failed)} tone={job.servers.failed ? "crit" : undefined} />
          <Stat label="Duration" value={elapsed(job.startedAt, job.finishedAt, now)} />
        </div>
        <JobProgress className="mt-4 h-2" done={isAgent ? job.servers.succeeded + job.servers.failed : job.packages.installed} total={isAgent ? job.servers.total : job.packages.total} status={job.status} />
      </Card>

      <div className="grid gap-4 xl:grid-cols-[320px_1fr]">
        <Card className="p-3">
          <p className="mb-2 px-2 text-[11px] font-semibold tracking-wide text-subtle uppercase">Servers</p>
          <ul className="space-y-1">
            {job.targets.map((t) => (
              <li key={t.id}>
                <button
                  onClick={() => setPicked(t.id)}
                  className={cn("w-full rounded-lg border p-3 text-left transition-colors", t.id === target?.id ? "border-primary/50 bg-primary-soft" : "border-transparent hover:bg-glass-hover")}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="flex min-w-0 items-center gap-2 text-sm font-medium">
                      <Server className="size-3.5 shrink-0 text-subtle" />
                      <span className="truncate">{t.server}</span>
                    </span>
                    <JobStatusBadge status={t.status} />
                  </div>
                  <JobProgress className="mt-2.5" done={isAgent ? Math.max(0, PHASES.findIndex((p) => p.id === t.phase)) + (t.status === "succeeded" ? 1 : 0) : t.done} total={isAgent ? PHASES.length : t.total} status={t.status} />
                  <p className="tabular mt-1.5 text-[11px] text-subtle">
                    {t.status === "queued"
                      ? "Waiting for the agent to pick it up…"
                      : `${isAgent ? "" : `${t.done}${t.total ? ` / ${t.total}` : ""} packages · `}${PHASES.find((p) => p.id === t.phase)?.label ?? (t.phase || "starting")} · ${elapsed(t.startedAt, t.finishedAt, now)}`}
                  </p>
                </button>
              </li>
            ))}
          </ul>
        </Card>

        {target && <TargetPanel key={target.id} jobId={job.id} target={target} phases={PHASES} isAgent={isAgent} />}
      </div>
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: "crit" }) {
  return (
    <div>
      <p className="text-xs text-muted">{label}</p>
      <p className={cn("tabular mt-1 text-2xl font-semibold", tone === "crit" && "text-crit")}>{value}</p>
    </div>
  );
}

function TargetPanel({ jobId, target, phases: PHASES, isAgent }: { jobId: string; target: Target; phases: typeof UPDATE_PHASES; isAgent: boolean }) {
  const { lines } = useJobLogs(jobId, target.id);
  const phaseIdx = PHASES.findIndex((p) => p.id === target.phase);
  const finished = !active(target.status);
  return (
    <div className="min-w-0 space-y-4">
      <Card>
        <CardHeader
          icon={Server}
          title={target.server}
          subtitle={
            target.status === "queued"
              ? "Queued: the agent picks the job up on its next report (within ~10 seconds)"
              : isAgent && target.phase === "restarting" && !finished
                ? "Installed: waiting for the server to report in on the new version"
                : undefined
          }
          action={<JobStatusBadge status={target.status} />}
        />
        <ol className="grid grid-cols-5 gap-2">
          {PHASES.map((p, i) => {
            const done = finished ? i <= Math.max(phaseIdx, PHASES.length - 1) && target.status === "succeeded" : i < phaseIdx;
            const current = !finished && i === phaseIdx;
            const failedHere = finished && target.status !== "succeeded" && i === Math.max(0, phaseIdx === PHASES.length - 1 ? PHASES.length - 1 : phaseIdx);
            return (
              <li key={p.id} className="flex flex-col items-center gap-1.5 text-center">
                <span
                  className={cn(
                    "grid size-7 place-items-center rounded-full border text-[11px] font-semibold",
                    failedHere ? "border-crit/50 bg-crit/15 text-crit" : done ? "border-ok/40 bg-ok/15 text-ok" : current ? "border-primary/60 bg-primary-soft text-primary-fg" : "border-line-strong text-subtle",
                  )}
                >
                  {done ? <Check className="size-3.5" /> : current ? <span className="live-dot size-2 rounded-full bg-current" /> : i + 1}
                </span>
                <span className={cn("text-[11px]", current ? "font-medium text-fg" : "text-subtle")}>{p.label}</span>
              </li>
            );
          })}
        </ol>
        {target.error && <p className="mt-4 rounded-lg border border-crit/30 bg-crit/10 p-3 text-sm text-crit">{target.error}</p>}
      </Card>

      {!isAgent && <Card>
        <CardHeader icon={PackageCheck} title={finished ? "Installed packages" : "Installed so far"} subtitle={target.total ? `${target.done} of ${target.total} expected` : `${target.done} package(s)`} />
        {target.installed.length === 0 ? (
          <p className="text-sm text-subtle">{finished ? "No packages were installed." : "Packages appear here as the package manager finishes each one."}</p>
        ) : (
          <ul className="flex flex-wrap gap-1.5">
            {[...target.installed].reverse().map((p) => (
              <li key={p.name} className="[animation:toast-in_.25s_ease-out]">
                <Badge tone="ok" icon={Check} className="font-mono">
                  {p.name}
                  {p.version && <span className="opacity-70"> {p.version}</span>}
                </Badge>
              </li>
            ))}
          </ul>
        )}
      </Card>}

      <LogPanel jobId={jobId} target={target} lines={lines} />
    </div>
  );
}

function LogPanel({ jobId, target, lines }: { jobId: string; target: Target; lines: Line[] }) {
  const box = useRef<HTMLDivElement>(null);
  const [follow, setFollow] = useState(true);
  useEffect(() => {
    if (follow && box.current) box.current.scrollTop = box.current.scrollHeight;
  }, [lines, follow]);
  const shown = lines.length > MAX_RENDERED ? lines.slice(-MAX_RENDERED) : lines;
  const running = active(target.status);
  return (
    <Card>
      <CardHeader
        icon={Terminal}
        title="Live output"
        subtitle={`${lines.length} line${lines.length === 1 ? "" : "s"}${running ? " · streaming from the server" : ""}`}
        action={
          <div className="flex items-center gap-3">
            <label className="flex items-center gap-2 text-xs text-muted">
              <Toggle key={String(follow)} label="Follow output" defaultChecked={follow} onChange={setFollow} />
              Follow
            </label>
            <a href={`/api/jobs/${jobId}/logs?target=${target.id}&format=text`} className="inline-flex items-center gap-1.5 rounded-lg px-2 py-1 text-xs font-medium text-muted hover:bg-glass-hover hover:text-fg">
              <ArrowDownToLine className="size-3.5" /> Download
            </a>
          </div>
        }
      />
      <div
        ref={box}
        onScroll={(e) => {
          const el = e.currentTarget;
          const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 24;
          if (atBottom !== follow) setFollow(atBottom);
        }}
        className="h-[460px] overflow-auto rounded-lg border border-line bg-[#05070f] p-3 font-mono text-[11.5px] leading-relaxed text-slate-300 scrollbar-thin"
      >
        {lines.length > MAX_RENDERED && <p className="mb-2 text-slate-500">… {lines.length - MAX_RENDERED} earlier lines hidden; download the full log.</p>}
        {shown.length === 0 && <p className="text-slate-500">{target.status === "queued" ? "Waiting for the agent to start…" : running ? "Waiting for output…" : "No output was recorded."}</p>}
        {shown.map((l) => (
          <p key={l.seq} className="flex gap-3 whitespace-pre-wrap">
            <span className="shrink-0 text-slate-600 select-none">{new Date(l.ts).toLocaleTimeString(undefined, { hour12: false })}</span>
            <span
              className={cn(
                "min-w-0 break-all",
                l.stream === "agent" && "font-semibold text-violet-300",
                l.stream === "stderr" && "text-amber-300",
                /^(E:|Error|error:|FATAL|fatal)|\bfailed\b/i.test(l.text) && "text-red-400",
                /^(Setting up|\(\d+\/\d+\) (Upgrading|Installing)|\s*(Upgrading|Installing)\s*:)/.test(l.text) && "text-emerald-300",
              )}
            >
              {l.text}
            </span>
          </p>
        ))}
        {running && <span className="ml-[4.6rem] inline-block h-3.5 w-1.5 animate-pulse bg-slate-400 align-middle" />}
      </div>
    </Card>
  );
}
