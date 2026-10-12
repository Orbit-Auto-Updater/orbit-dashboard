"use client";

import {
  CircleAlert,
  CircleCheck,
  CircleDashed,
  CirclePause,
  CircleX,
  Info,
  Loader,
  RotateCw,
  TriangleAlert,
  type LucideIcon,
} from "lucide-react";
import { useState, type ButtonHTMLAttributes, type ReactNode } from "react";

export function cn(...c: (string | false | null | undefined)[]) {
  return c.filter(Boolean).join(" ");
}

/* ------------------------------------------------------------------ layout */

export function PageHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        {description && <p className="mt-1 text-sm text-muted">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function Card({ className, children }: { className?: string; children: ReactNode }) {
  return <section className={cn("glass min-w-0 p-5", className)}>{children}</section>;
}

export function CardHeader({
  title,
  subtitle,
  icon: Icon,
  action,
}: {
  title: string;
  subtitle?: ReactNode;
  icon?: LucideIcon;
  action?: ReactNode;
}) {
  return (
    <div className="mb-4 flex items-start justify-between gap-3">
      <div className="flex min-w-0 items-center gap-2.5">
        {Icon && (
          <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-primary-soft text-primary-fg">
            <Icon className="size-4" />
          </span>
        )}
        <div className="min-w-0">
          <h2 className="truncate text-sm font-semibold">{title}</h2>
          {subtitle && <p className="truncate text-xs text-subtle">{subtitle}</p>}
        </div>
      </div>
      {action}
    </div>
  );
}

/* ----------------------------------------------------------------- buttons */

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "ghost" | "danger";
  size?: "sm" | "md";
  icon?: LucideIcon;
};

export function Button({ variant = "secondary", size = "md", icon: Icon, className, children, ...rest }: ButtonProps) {
  return (
    <button
      type="button"
      {...rest}
      className={cn(
        "inline-flex items-center justify-center gap-2 rounded-lg font-medium whitespace-nowrap transition-colors focus-visible:ring-2 focus-visible:ring-[var(--primary-ring)] focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50",
        size === "sm" ? "h-8 px-3 text-xs" : "h-9 px-3.5 text-sm",
        variant === "primary" &&
          "bg-primary text-white shadow-[0_8px_24px_-8px_var(--primary-ring)] hover:brightness-110",
        variant === "secondary" && "border border-line-strong bg-glass text-fg hover:bg-glass-hover",
        variant === "ghost" && "text-muted hover:bg-glass-hover hover:text-fg",
        variant === "danger" && "border border-crit/30 bg-crit/10 text-crit hover:bg-crit/20",
        className,
      )}
    >
      {Icon && <Icon className={size === "sm" ? "size-3.5" : "size-4"} />}
      {children}
    </button>
  );
}

export function IconButton({
  icon: Icon,
  label,
  className,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { icon: LucideIcon; label: string }) {
  return (
    <button
      {...rest}
      aria-label={label}
      title={label}
      className={cn(
        "grid size-8 place-items-center rounded-lg text-muted transition-colors hover:bg-glass-hover hover:text-fg focus-visible:ring-2 focus-visible:ring-[var(--primary-ring)] focus-visible:outline-none",
        className,
      )}
    >
      <Icon className="size-4" />
    </button>
  );
}

/* ------------------------------------------------------------------ badges */

export type Tone = "ok" | "warn" | "crit" | "info" | "neutral" | "primary";

const toneClass: Record<Tone, string> = {
  ok: "bg-ok/12 text-ok ring-ok/25",
  warn: "bg-warn/12 text-warn ring-warn/25",
  crit: "bg-crit/12 text-crit ring-crit/30",
  info: "bg-info/12 text-info ring-info/25",
  primary: "bg-primary-soft text-primary-fg ring-primary/30",
  neutral: "bg-fg/5 text-muted ring-line-strong",
};

export function Badge({ tone = "neutral", icon: Icon, children, className }: { tone?: Tone; icon?: LucideIcon; children: ReactNode; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-medium whitespace-nowrap ring-1 ring-inset",
        toneClass[tone],
        className,
      )}
    >
      {Icon && <Icon className="size-3" />}
      {children}
    </span>
  );
}

const statusMap: Record<string, { tone: Tone; icon: LucideIcon; label?: string }> = {
  healthy: { tone: "ok", icon: CircleCheck, label: "Healthy" },
  online: { tone: "ok", icon: CircleCheck, label: "Online" },
  running: { tone: "ok", icon: CircleCheck, label: "Running" },
  active: { tone: "ok", icon: CircleCheck, label: "Active" },
  success: { tone: "ok", icon: CircleCheck, label: "Success" },
  warning: { tone: "warn", icon: TriangleAlert, label: "Warning" },
  partial: { tone: "warn", icon: TriangleAlert, label: "Partial" },
  invited: { tone: "info", icon: CircleDashed, label: "Invited" },
  launching: { tone: "info", icon: Loader, label: "Launching" },
  restarting: { tone: "crit", icon: RotateCw, label: "Restarting" },
  critical: { tone: "crit", icon: CircleAlert, label: "Critical" },
  errored: { tone: "crit", icon: CircleX, label: "Errored" },
  failed: { tone: "crit", icon: CircleX, label: "Failed" },
  suspended: { tone: "crit", icon: CircleX, label: "Suspended" },
  offline: { tone: "neutral", icon: CircleX, label: "Offline" },
  exited: { tone: "neutral", icon: CircleX, label: "Exited" },
  stopped: { tone: "neutral", icon: CirclePause, label: "Stopped" },
  paused: { tone: "neutral", icon: CirclePause, label: "Paused" },
  inactive: { tone: "neutral", icon: CircleDashed, label: "Inactive" },
  info: { tone: "info", icon: Info, label: "Info" },
};

/** Status always pairs colour with an icon and a label. */
export function StatusBadge({ status, label }: { status: string; label?: string }) {
  const s = statusMap[status] ?? { tone: "neutral" as Tone, icon: Info };
  return (
    <Badge tone={s.tone} icon={s.icon}>
      {label ?? s.label ?? status}
    </Badge>
  );
}

export function StatusDot({ status }: { status: string }) {
  const tone = statusMap[status]?.tone ?? "neutral";
  const color = { ok: "text-ok", warn: "text-warn", crit: "text-crit", info: "text-info", primary: "text-primary", neutral: "text-subtle" }[tone];
  return (
    <span className={cn("relative inline-flex size-2 shrink-0 rounded-full bg-current", color, tone === "crit" && "live-dot")} />
  );
}

export type Env = "production" | "staging" | "development";

export function EnvBadge({ env }: { env: Env }) {
  return <Badge tone={env === "production" ? "primary" : env === "staging" ? "info" : "neutral"}>{env}</Badge>;
}

/* ------------------------------------------------------------------ meters */

export function thresholdTone(v: number, warn = 75, crit = 90): Tone {
  return v >= crit ? "crit" : v >= warn ? "warn" : "ok";
}

const barColor: Record<Tone, string> = {
  ok: "bg-s1",
  warn: "bg-warn",
  crit: "bg-crit",
  info: "bg-info",
  primary: "bg-primary",
  neutral: "bg-subtle",
};

/** Utilisation bar: neutral purple until it crosses a threshold. */
export function Meter({ value, warn = 75, crit = 90, className, label }: { value: number; warn?: number; crit?: number; className?: string; label?: string }) {
  const tone = thresholdTone(value, warn, crit);
  return (
    <div
      role="meter"
      aria-valuenow={Math.round(value)}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label={label}
      className={cn("h-1.5 w-full min-w-14 overflow-hidden rounded-full bg-fg/8", className)}
    >
      <div className={cn("h-full rounded-full transition-[width] duration-700", barColor[tone])} style={{ width: `${Math.min(100, value)}%` }} />
    </div>
  );
}

export function MeterRow({ label, value, warn, crit, suffix = "%" }: { label: string; value: number; warn?: number; crit?: number; suffix?: string }) {
  const tone = thresholdTone(value, warn, crit);
  return (
    <div className="flex items-center gap-3">
      {label && <span className="w-10 shrink-0 text-xs text-subtle">{label}</span>}
      <Meter value={value} warn={warn} crit={crit} label={label || undefined} />
      <span
        className={cn(
          "tabular w-10 shrink-0 text-right text-xs font-medium",
          tone === "crit" ? "text-crit" : tone === "warn" ? "text-warn" : "text-muted",
        )}
      >
        {Math.round(value)}
        {suffix}
      </span>
    </div>
  );
}

/* ------------------------------------------------------------------ inputs */

export function Toggle({ defaultChecked = false, label, onChange }: { defaultChecked?: boolean; label: string; onChange?: (v: boolean) => void }) {
  const [on, setOn] = useState(defaultChecked);
  return (
    <button
      role="switch"
      aria-checked={on}
      aria-label={label}
      onClick={() => {
        setOn(!on);
        onChange?.(!on);
      }}
      className={cn(
        "relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors focus-visible:ring-2 focus-visible:ring-[var(--primary-ring)] focus-visible:outline-none",
        on ? "bg-primary" : "bg-fg/15",
      )}
    >
      <span className={cn("inline-block size-4 rounded-full bg-white shadow transition-transform", on ? "translate-x-[18px]" : "translate-x-0.5")} />
    </button>
  );
}

export function Segmented<T extends string>({
  options,
  value,
  onChange,
  size = "md",
}: {
  options: { value: T; label: string; count?: number }[];
  value: T;
  onChange: (v: T) => void;
  size?: "sm" | "md";
}) {
  return (
    <div role="tablist" className="inline-flex max-w-full overflow-x-auto rounded-lg border border-line bg-inset p-0.5 scrollbar-thin">
      {options.map((o) => (
        <button
          key={o.value}
          role="tab"
          aria-selected={value === o.value}
          onClick={() => onChange(o.value)}
          className={cn(
            "inline-flex items-center gap-1.5 rounded-md font-medium whitespace-nowrap transition-colors",
            size === "sm" ? "px-2.5 py-1 text-xs" : "px-3 py-1.5 text-sm",
            value === o.value ? "bg-primary-soft text-primary-fg shadow-sm ring-1 ring-primary/30 ring-inset" : "text-muted hover:text-fg",
          )}
        >
          {o.label}
          {o.count !== undefined && (
            <span className={cn("tabular rounded px-1 text-[10px]", value === o.value ? "bg-primary/20" : "bg-fg/8")}>{o.count}</span>
          )}
        </button>
      ))}
    </div>
  );
}

export function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="text-xs font-medium text-muted">{label}</span>
      <div className="mt-1.5">{children}</div>
      {hint && <span className="mt-1 block text-[11px] text-subtle">{hint}</span>}
    </label>
  );
}

export const inputClass =
  "h-9 w-full rounded-lg border border-line-strong bg-inset px-3 text-sm text-fg placeholder:text-subtle focus:border-primary/60 focus:ring-2 focus:ring-[var(--primary-ring)] focus:outline-none";

/* ------------------------------------------------------------------- misc */

export function Avatar({ name, size = "md" }: { name: string; size?: "sm" | "md" | "lg" }) {
  const initials = name
    .split(" ")
    .map((p) => p[0])
    .slice(0, 2)
    .join("");
  return (
    <span
      className={cn(
        "grid shrink-0 place-items-center rounded-full bg-gradient-to-br from-violet-500 to-indigo-600 font-semibold text-white ring-2 ring-white/10",
        size === "sm" && "size-7 text-[11px]",
        size === "md" && "size-9 text-xs",
        size === "lg" && "size-16 text-lg",
      )}
    >
      {initials}
    </span>
  );
}

export function Table({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cn("-mx-5 overflow-x-auto scrollbar-thin", className)}>
      <table className="w-full min-w-[640px] border-collapse text-sm [&_td]:px-5 [&_td]:py-3 [&_th]:px-5 [&_th]:pb-2.5 [&_th]:text-left [&_th]:text-[11px] [&_th]:font-medium [&_th]:tracking-wide [&_th]:text-subtle [&_th]:uppercase [&_tbody_tr]:border-t [&_tbody_tr]:border-line [&_tbody_tr:hover]:bg-fg/[0.025]">
        {children}
      </table>
    </div>
  );
}

export function EmptyNote({ children }: { children: ReactNode }) {
  return <p className="rounded-lg border border-dashed border-line-strong p-6 text-center text-sm text-subtle">{children}</p>;
}
