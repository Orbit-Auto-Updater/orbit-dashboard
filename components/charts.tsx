"use client";

import { useEffect, useId, useRef, useState } from "react";
import { cn, thresholdTone } from "@/components/ui";

export type Series = { key: string; label: string; color: string; data: number[] };

function useWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setWidth(Math.floor(e.contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, width] as const;
}

/** Cardinal spline through points, as an SVG path. */
function smoothPath(pts: [number, number][]) {
  if (pts.length < 2) return "";
  const t = 0.18;
  let d = `M${pts[0][0]},${pts[0][1]}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] ?? pts[i];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[i + 2] ?? p2;
    const c1x = p1[0] + (p2[0] - p0[0]) * t;
    const c1y = p1[1] + (p2[1] - p0[1]) * t;
    const c2x = p2[0] - (p3[0] - p1[0]) * t;
    const c2y = p2[1] - (p3[1] - p1[1]) * t;
    d += ` C${c1x},${c1y} ${c2x},${c2y} ${p2[0]},${p2[1]}`;
  }
  return d;
}

/** Compact duration label: 45s, 6m, 13h, 7d. */
function span(sec: number) {
  if (sec < 90) return `${Math.round(sec)}s`;
  if (sec < 5400) return `${Math.round(sec / 60)}m`;
  if (sec < 172800) return `${Math.round(sec / 3600)}h`;
  return `${Math.round(sec / 86400)}d`;
}

function niceMax(v: number) {
  if (v <= 0) return 1;
  const exp = Math.pow(10, Math.floor(Math.log10(v)));
  const f = v / exp;
  return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * exp;
}

/**
 * Real-time line/area chart. Each series carries N+1 points; index 0 sits just
 * off the left edge so the stream can slide smoothly between ticks.
 */
export function LiveChart({
  series,
  height = 220,
  max,
  format = (v) => `${v.toFixed(0)}%`,
  area = true,
  legend = series.length > 1,
  stepMs = 10_000,
  animate = true,
  minMax = 1,
}: {
  series: Series[];
  height?: number;
  max?: number;
  format?: (v: number) => string;
  area?: boolean;
  legend?: boolean;
  /** Time between points, for the axis labels and the scrolling animation. */
  stepMs?: number;
  animate?: boolean;
  /** Smallest y-axis maximum, so near-empty series still get a readable scale. */
  minMax?: number;
}) {
  const uid = useId().replace(/:/g, "");
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);

  // Restart the slide animation whenever the data actually changes.
  const head = series[0]?.data ?? [];
  const animKey = head.join(",");

  const n = head.length - 1; // visible points
  const ml = 40;
  const mr = 8;
  const mt = 8;
  const mb = 22;
  const pw = Math.max(0, width - ml - mr);
  const ph = height - mt - mb;
  const stepX = n > 1 ? pw / (n - 1) : 0;
  const yMax = max ?? niceMax(Math.max(minMax, Math.max(...series.flatMap((s) => s.data)) * 1.15));
  const x = (i: number) => ml + (i - 1) * stepX;
  const y = (v: number) => mt + ph - (v / yMax) * ph;
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => f * yMax);
  const seconds = Math.round(((n - 1) * stepMs) / 1000);

  function onMove(e: React.PointerEvent<SVGRectElement>) {
    const rect = e.currentTarget.getBoundingClientRect();
    const i = Math.round((e.clientX - rect.left) / stepX) + 1;
    setHover(Math.min(n, Math.max(1, i)));
  }

  return (
    <div>
      {legend && (
        <div className="mb-3 flex flex-wrap items-center gap-x-5 gap-y-1.5">
          {series.map((s) => (
            <div key={s.key} className="flex items-center gap-2 text-xs">
              <span className="h-0.5 w-3.5 rounded-full" style={{ background: s.color }} />
              <span className="text-muted">{s.label}</span>
              <span className="tabular font-semibold text-fg">{format(s.data[s.data.length - 1])}</span>
            </div>
          ))}
        </div>
      )}
      <div ref={ref} className="relative w-full" style={{ height }}>
        {width > 0 && (
          <svg width={width} height={height} className="block overflow-visible" role="img" aria-label={`Live chart: ${series.map((s) => s.label).join(", ")}`}>
            <defs>
              <clipPath id={`clip-${uid}`}>
                <rect x={ml} y={0} width={pw} height={height} />
              </clipPath>
              {series.map((s) => (
                <linearGradient key={s.key} id={`fill-${uid}-${s.key}`} x1="0" x2="0" y1="0" y2="1">
                  <stop offset="0%" stopColor={s.color} stopOpacity={0.28} />
                  <stop offset="100%" stopColor={s.color} stopOpacity={0} />
                </linearGradient>
              ))}
            </defs>

            {ticks.map((t) => (
              <g key={t}>
                <line x1={ml} x2={ml + pw} y1={y(t)} y2={y(t)} stroke="var(--grid)" strokeDasharray={t === 0 ? undefined : "2 4"} />
                <text x={ml - 8} y={y(t)} dy="0.32em" textAnchor="end" className="tabular fill-[var(--subtle)] text-[10px]">
                  {format(t)}
                </text>
              </g>
            ))}
            <text x={ml} y={height - 4} className="fill-[var(--subtle)] text-[10px]">
              −{span(seconds)}
            </text>
            <text x={ml + pw / 2} y={height - 4} textAnchor="middle" className="fill-[var(--subtle)] text-[10px]">
              −{span(seconds / 2)}
            </text>
            <text x={ml + pw} y={height - 4} textAnchor="end" className="fill-[var(--subtle)] text-[10px]">
              now
            </text>

            <g clipPath={`url(#clip-${uid})`}>
              <g
                key={animKey}
                style={animate ? { ["--chart-step" as string]: `${stepX}px`, animation: `chart-slide ${stepMs}ms linear` } : undefined}
              >
                {series.map((s) => {
                  const pts = s.data.map((v, i) => [x(i), y(v)] as [number, number]);
                  const line = smoothPath(pts);
                  return (
                    <g key={s.key}>
                      {area && <path d={`${line} L${pts[pts.length - 1][0]},${y(0)} L${pts[0][0]},${y(0)} Z`} fill={`url(#fill-${uid}-${s.key})`} />}
                      <path d={line} fill="none" stroke={s.color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
                    </g>
                  );
                })}
              </g>
            </g>

            {hover !== null && (
              <g pointerEvents="none">
                <line x1={x(hover)} x2={x(hover)} y1={mt} y2={mt + ph} stroke="var(--line-strong)" />
                {series.map((s) => (
                  <circle key={s.key} cx={x(hover)} cy={y(s.data[hover])} r={4} fill={s.color} stroke="var(--bg)" strokeWidth={2} />
                ))}
              </g>
            )}

            <rect
              x={ml}
              y={mt}
              width={pw}
              height={ph}
              fill="transparent"
              onPointerMove={onMove}
              onPointerLeave={() => setHover(null)}
            />
          </svg>
        )}

        {hover !== null && width > 0 && (
          <div
            className="glass glass-strong pointer-events-none absolute top-1 z-10 min-w-32 rounded-lg px-3 py-2 text-xs shadow-xl"
            style={x(hover) > width / 2 ? { right: width - x(hover) + 12 } : { left: x(hover) + 12 }}
          >
            <p className="mb-1 text-subtle">{span(((n - hover) * stepMs) / 1000)} ago</p>
            {series.map((s) => (
              <div key={s.key} className="flex items-center justify-between gap-4">
                <span className="flex items-center gap-1.5 text-muted">
                  <span className="size-2 rounded-full" style={{ background: s.color }} />
                  {s.label}
                </span>
                <span className="tabular font-semibold text-fg">{format(s.data[hover])}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/** Compact trend line for cards and table rows. */
export function Sparkline({ data, color = "var(--s1)", height = 32, max = 100, className }: { data: number[]; color?: string; height?: number; max?: number; className?: string }) {
  const uid = useId().replace(/:/g, "");
  const w = 100;
  const pts = data.slice(1).map((v, i, a) => [(i / (a.length - 1)) * w, height - (v / max) * (height - 2) - 1] as [number, number]);
  const line = smoothPath(pts);
  return (
    <svg viewBox={`0 0 ${w} ${height}`} preserveAspectRatio="none" className={cn("block w-full", className)} style={{ height }} aria-hidden>
      <defs>
        <linearGradient id={`sp-${uid}`} x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity={0.25} />
          <stop offset="100%" stopColor={color} stopOpacity={0} />
        </linearGradient>
      </defs>
      <path d={`${line} L${w},${height} L0,${height} Z`} fill={`url(#sp-${uid})`} />
      <path d={line} fill="none" stroke={color} strokeWidth={1.75} vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
    </svg>
  );
}

/** Radial utilisation gauge; turns amber/red past thresholds. */
export function RingGauge({ value, label, sub, warn = 75, crit = 90, size = 112 }: { value: number; label: string; sub?: string; warn?: number; crit?: number; size?: number }) {
  const tone = thresholdTone(value, warn, crit);
  const color = tone === "crit" ? "var(--crit)" : tone === "warn" ? "var(--warn)" : "var(--s1)";
  const r = size / 2 - 8;
  const c = 2 * Math.PI * r;
  const arc = c * 0.75;
  return (
    <div className="flex flex-col items-center">
      <div className="relative" style={{ width: size, height: size }}>
        <svg width={size} height={size} className="rotate-[135deg]">
          <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--grid)" strokeWidth={8} strokeDasharray={`${arc} ${c}`} strokeLinecap="round" />
          <circle
            cx={size / 2}
            cy={size / 2}
            r={r}
            fill="none"
            stroke={color}
            strokeWidth={8}
            strokeDasharray={`${(arc * Math.min(100, value)) / 100} ${c}`}
            strokeLinecap="round"
            className="transition-[stroke-dasharray] duration-700"
          />
        </svg>
        <div className="absolute inset-0 grid place-items-center">
          <span className={cn("tabular text-xl font-semibold", tone === "crit" ? "text-crit" : tone === "warn" ? "text-warn" : "text-fg")}>
            {Math.round(value)}%
          </span>
        </div>
      </div>
      <p className="-mt-3 text-xs font-medium">{label}</p>
      {sub && <p className="text-[11px] text-subtle">{sub}</p>}
    </div>
  );
}
