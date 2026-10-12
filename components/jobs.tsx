"use client";

import { CalendarClock, CircleAlert, CircleCheck, CircleDashed, CirclePause, CircleX, LoaderCircle, type LucideIcon } from "lucide-react";
import { Badge, cn, type Tone } from "@/components/ui";

export type JobStatus = "queued" | "running" | "succeeded" | "failed" | "partial" | "skipped" | "expired";

const STATUS: Record<JobStatus, { label: string; tone: Tone; icon: LucideIcon; spin?: boolean }> = {
  queued: { label: "Queued", tone: "neutral", icon: CircleDashed },
  running: { label: "Running", tone: "primary", icon: LoaderCircle, spin: true },
  succeeded: { label: "Succeeded", tone: "ok", icon: CircleCheck },
  failed: { label: "Failed", tone: "crit", icon: CircleX },
  partial: { label: "Partly failed", tone: "warn", icon: CircleAlert },
  skipped: { label: "Skipped", tone: "warn", icon: CirclePause },
  expired: { label: "Not picked up", tone: "crit", icon: CircleX },
};

export function JobStatusBadge({ status }: { status: JobStatus }) {
  const s = STATUS[status] ?? STATUS.queued;
  return (
    <Badge tone={s.tone}>
      <s.icon className={cn("size-3", s.spin && "animate-spin")} />
      {s.label}
    </Badge>
  );
}

export function TriggerBadge({ trigger }: { trigger: string }) {
  return trigger === "schedule" ? (
    <Badge icon={CalendarClock}>scheduled</Badge>
  ) : (
    <Badge>manual</Badge>
  );
}

/** Progress bar: packages done of total, animated stripes while running. */
export function JobProgress({ done, total, status, className }: { done: number; total: number; status: JobStatus; className?: string }) {
  const pct = total > 0 ? Math.min(100, (done / total) * 100) : status === "succeeded" ? 100 : 0;
  const color = status === "failed" || status === "expired" ? "bg-crit" : status === "partial" || status === "skipped" ? "bg-warn" : status === "succeeded" ? "bg-ok" : "bg-primary";
  return (
    <div className={cn("h-1.5 w-full overflow-hidden rounded-full bg-fg/8", className)} role="progressbar" aria-valuenow={Math.round(pct)} aria-valuemin={0} aria-valuemax={100}>
      <div
        className={cn("h-full rounded-full transition-[width] duration-700", color, status === "running" && "bg-[length:16px_16px] bg-[linear-gradient(45deg,rgba(255,255,255,.18)_25%,transparent_25%,transparent_50%,rgba(255,255,255,.18)_50%,rgba(255,255,255,.18)_75%,transparent_75%)]")}
        style={{ width: `${status === "running" && pct < 4 ? 4 : pct}%` }}
      />
    </div>
  );
}

export function elapsed(from: number | null, to: number | null, now: number) {
  if (!from) return "—";
  const s = Math.max(0, Math.round(((to ?? now) - from) / 1000));
  return s < 60 ? `${s}s` : s < 3600 ? `${Math.floor(s / 60)}m ${s % 60}s` : `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`;
}
