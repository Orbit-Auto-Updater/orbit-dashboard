"use client";

/** Browser-side API access: fetch helpers, polling, the signed-in user and agent commands. */
import { createContext, createElement, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { useLive, useToast } from "@/components/providers";
import type { Permission } from "@/lib/permissions";

export class HttpError extends Error {
  constructor(public status: number, message: string, public details?: Record<string, string>) {
    super(message);
  }
}

export async function api<T = unknown>(url: string, opts: { method?: string; body?: unknown; headers?: Record<string, string> } = {}): Promise<T> {
  const res = await fetch(url, {
    method: opts.method ?? (opts.body === undefined ? "GET" : "POST"),
    headers: { ...(opts.body !== undefined ? { "Content-Type": "application/json" } : {}), ...opts.headers },
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
    credentials: "same-origin",
    cache: "no-store",
  });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && !url.startsWith("/api/auth/") && !url.startsWith("/api/setup/") && !url.startsWith("/api/invite/")) {
    const next = window.location.pathname + window.location.search;
    window.location.href = `/login${next !== "/" ? `?next=${encodeURIComponent(next)}` : ""}`;
  }
  if (res.status === 503 && (data as { setup?: boolean }).setup) window.location.href = "/setup";
  if (!res.ok) throw new HttpError(res.status, (data as { error?: string }).error ?? `Request failed (${res.status})`, (data as { details?: Record<string, string> }).details);
  return data as T;
}

/**
 * Fetch JSON and keep it fresh. Polls every `interval` ms while the global
 * Live toggle is on and the tab is visible. Pass null to skip.
 */
export function useApi<T>(url: string | null, { interval = 5000 }: { interval?: number | false } = {}) {
  const { paused } = useLive();
  // The last response is kept while a new URL loads, so pages don't flash empty.
  const [state, setState] = useState<{ url: string | null; data: T | null; error: HttpError | null }>({ url: null, data: null, error: null });
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (!url) return;
    let cancelled = false;
    const load = async () => {
      try {
        const data = await api<T>(url);
        if (!cancelled) setState({ url, data, error: null });
      } catch (err) {
        const error = err instanceof HttpError ? err : new HttpError(0, (err as Error).message);
        if (!cancelled) setState((s) => ({ url, data: s.data, error }));
      }
    };
    load();
    const id = interval && !paused ? setInterval(() => document.visibilityState === "visible" && load(), interval) : undefined;
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [url, interval, paused, tick]);

  const reload = useCallback(() => setTick((t) => t + 1), []);
  return { data: state.data, error: state.error, loading: state.url !== url, reload };
}

// --------------------------------------------------------------- current user

export type Me = {
  id: string;
  name: string;
  email: string;
  role: string;
  roleName: string;
  timezone: string | null;
  permissions: Permission[];
  createdAt: number | null;
};

type MeCtx = { me: Me | null; orgName: string; can: (p: Permission) => boolean; reload: () => void };
const MeContext = createContext<MeCtx>({ me: null, orgName: "", can: () => false, reload: () => {} });

export function MeProvider({ children }: { children: ReactNode }) {
  const { data, reload } = useApi<{ user: Me; orgName: string }>("/api/me", { interval: 60_000 });
  const value: MeCtx = {
    me: data?.user ?? null,
    orgName: data?.orgName ?? "",
    can: (p) => !!data?.user.permissions.includes(p),
    reload,
  };
  return createElement(MeContext.Provider, { value }, children);
}

export const useMe = () => useContext(MeContext);

// ------------------------------------------------------------------- commands

type CommandRow = { id: string; status: string; label: string; output: string | null; error: string | null; server: string };

/**
 * Queue an agent command and follow it: a progress toast while it waits for
 * the agent (delivered on its next report), then the result.
 */
export function useCommand() {
  const { toast } = useToast();
  return useCallback(
    async (serverId: string, type: string, args: Record<string, unknown> = {}, onDone?: () => void) => {
      let queued: { id: string; label: string };
      try {
        queued = await api<{ id: string; label: string }>(`/api/servers/${serverId}/commands`, { body: { type, args } });
      } catch (err) {
        toast({ title: "Couldn't send command", body: (err as Error).message, tone: "error" });
        return;
      }
      const tid = toast({ title: queued.label, body: "Queued; waiting for the agent to pick it up…", tone: "progress" });
      const started = Date.now();
      const longRunning = type === "updates.apply" || type === "updates.check";
      const limit = longRunning ? 60 * 60_000 : 5 * 60_000;
      while (Date.now() - started < limit) {
        await new Promise((r) => setTimeout(r, 2000));
        let c: CommandRow;
        try {
          c = await api<CommandRow>(`/api/commands/${queued.id}`);
        } catch {
          continue;
        }
        if (c.status === "delivered") toast({ id: tid, title: queued.label, body: `Running on ${c.server}…`, tone: "progress" });
        if (c.status === "succeeded") {
          toast({ id: tid, title: `${queued.label}: done`, body: c.output?.split("\n").slice(0, 3).join("\n") || c.server, tone: "success" });
          onDone?.();
          return c;
        }
        if (c.status === "failed" || c.status === "expired") {
          toast({ id: tid, title: `${queued.label}: ${c.status === "expired" ? "agent didn't respond" : "failed"}`, body: c.error ?? (c.status === "expired" ? "The server may be offline." : ""), tone: "error" });
          onDone?.();
          return c;
        }
      }
      toast({ id: tid, title: queued.label, body: "Still running; check the server's activity for the result.", tone: "info" });
    },
    [toast],
  );
}

/** Current time, refreshed every intervalMs (0 until the first tick after mount). */
export function useNow(intervalMs = 1000) {
  const [now, setNow] = useState(0);
  useEffect(() => {
    const tick = () => setNow(Date.now());
    const first = setTimeout(tick, 0);
    const id = setInterval(tick, intervalMs);
    return () => {
      clearTimeout(first);
      clearInterval(id);
    };
  }, [intervalMs]);
  return now;
}

// ----------------------------------------------------------------- update jobs

/**
 * Start an update install job and open its live view.
 * body: { serverIds: [...] | "all", packages?: [...], securityOnly?: true }
 */
export function useStartUpdateJob() {
  const { toast } = useToast();
  return useCallback(
    async (body: { serverIds: string[] | "all"; packages?: string[]; securityOnly?: boolean }) => {
      try {
        const r = await api<{ jobId: string; queued: number }>("/api/jobs", { body });
        window.location.assign(`/jobs/${r.jobId}`);
        return r;
      } catch (err) {
        toast({ title: "Couldn't start the update", body: (err as Error).message, tone: "error" });
      }
    },
    [toast],
  );
}

// ------------------------------------------------------------------ formatting

export function ago(ts: number | string | null | undefined, now = Date.now()) {
  if (!ts) return "—";
  const t = typeof ts === "string" ? Date.parse(ts) : ts;
  const s = Math.round((now - t) / 1000);
  if (s < 0) return "just now";
  if (s < 45) return `${s}s ago`;
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  if (s < 86400) return `${Math.round(s / 3600)}h ago`;
  return `${Math.round(s / 86400)}d ago`;
}

/** Seconds elapsed since an ISO timestamp (for uptimes). */
export function secondsSince(iso: string | undefined) {
  return iso ? Math.max(0, (Date.now() - Date.parse(iso)) / 1000) : 0;
}

export function isPast(ts: number) {
  return ts < Date.now();
}

export function duration(seconds: number) {
  if (!seconds) return "—";
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return d ? `${d}d ${h}h` : h ? `${h}h ${m}m` : `${m}m`;
}

export function bytes(n: number, digits = 1) {
  const units = ["B", "KB", "MB", "GB", "TB"];
  let i = 0;
  while (n >= 1024 && i < units.length - 1) {
    n /= 1024;
    i++;
  }
  return `${n.toFixed(i === 0 ? 0 : digits)} ${units[i]}`;
}

export const rate = (bps: number) => `${bytes(bps)}/s`;

export function dateTime(ts: number | null | undefined) {
  if (!ts) return "—";
  return new Date(ts).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}
