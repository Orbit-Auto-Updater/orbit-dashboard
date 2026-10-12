"use client";

import {
  Bell,
  Boxes,
  Bot,
  LayoutDashboard,
  ListChecks,
  LogOut,
  Menu,
  Moon,
  PackageCheck,
  Pause,
  Play,
  Server,
  Settings,
  ShieldAlert,
  Sun,
  TriangleAlert,
  UserCog,
  X,
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Suspense, useEffect, useState, type ReactNode } from "react";
import { useLive } from "@/components/providers";
import { Avatar, cn, IconButton } from "@/components/ui";
import { api, useApi, useMe } from "@/lib/client";
import type { Permission } from "@/lib/permissions";

type Counts = { openAlerts: number; criticalAlerts: number; seriousVulns: number; pendingUpdates: number; runningJobs: number; outdatedAgents: number };
type NavItem = { href: string; label: string; icon: LucideIcon; badge?: (c: Counts) => { value: number; tone: "crit" | "primary" } | null; perm?: Permission[] };

const nav: { section: string; items: NavItem[] }[] = [
  {
    section: "Monitor",
    items: [
      { href: "/", label: "Overview", icon: LayoutDashboard },
      { href: "/servers", label: "Servers", icon: Server },
      { href: "/applications", label: "Applications", icon: Boxes },
      { href: "/alerts", label: "Alerts & logs", icon: TriangleAlert, badge: (c) => (c.openAlerts ? { value: c.openAlerts, tone: c.criticalAlerts ? "crit" : "primary" } : null) },
    ],
  },
  {
    section: "Maintain",
    items: [
      { href: "/updates", label: "Updates", icon: PackageCheck, badge: (c) => (c.pendingUpdates ? { value: c.pendingUpdates, tone: "primary" } : null) },
      { href: "/jobs", label: "Jobs", icon: ListChecks, badge: (c) => (c.runningJobs ? { value: c.runningJobs, tone: "primary" } : null) },
      { href: "/vulnerabilities", label: "Vulnerabilities", icon: ShieldAlert, badge: (c) => (c.seriousVulns ? { value: c.seriousVulns, tone: "crit" } : null) },
    ],
  },
  {
    section: "Administration",
    items: [
      { href: "/agents", label: "Agents", icon: Bot, badge: (c) => (c.outdatedAgents ? { value: c.outdatedAgents, tone: "primary" } : null) },
      { href: "/users", label: "Users & roles", icon: UserCog, perm: ["users.manage"] },
      { href: "/settings", label: "Settings", icon: Settings, perm: ["org.settings", "servers.manage"] },
    ],
  },
];

async function signOut() {
  await api("/api/auth/logout", { body: {} }).catch(() => {});
  window.location.href = "/login";
}

function Logo({ org }: { org: string }) {
  return (
    <Link href="/" className="flex items-center gap-2.5 px-2">
      <span className="grid size-8 place-items-center rounded-lg bg-gradient-to-br from-violet-500 to-indigo-600 shadow-[0_6px_20px_-6px_var(--primary-ring)]">
        <svg viewBox="0 0 24 24" className="size-4 text-white" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path d="M4 17l6-6-6-6" />
          <path d="M12 19h8" />
        </svg>
      </span>
      <span className="min-w-0 leading-tight">
        <span className="block text-sm font-semibold tracking-tight">Linux Dash</span>
        <span className="block truncate text-[11px] text-subtle">{org || "Fleet & patching"}</span>
      </span>
    </Link>
  );
}

/**
 * usePathname needs a Suspense boundary on routes with dynamic segments
 * (e.g. /jobs/[id]); the fallback renders the same sidebar without the
 * active-page highlight so the shell still prerenders.
 */
function Sidebar(props: { counts: Counts | null; onNavigate?: () => void }) {
  return (
    <Suspense fallback={<SidebarContent {...props} pathname="" />}>
      <SidebarWithPath {...props} />
    </Suspense>
  );
}

function SidebarWithPath(props: { counts: Counts | null; onNavigate?: () => void }) {
  return <SidebarContent {...props} pathname={usePathname()} />;
}

function SidebarContent({ counts, onNavigate, pathname }: { counts: Counts | null; onNavigate?: () => void; pathname: string }) {
  const { me, orgName, can } = useMe();
  return (
    <div className="flex h-full flex-col gap-6 p-4">
      <Logo org={orgName} />
      <nav className="flex-1 space-y-6 overflow-y-auto scrollbar-thin">
        {nav.map((group) => {
          const items = group.items.filter((i) => !i.perm || i.perm.some((p) => can(p)));
          if (!items.length) return null;
          return (
            <div key={group.section}>
              <p className="mb-2 px-3 text-[10px] font-semibold tracking-[0.12em] text-subtle uppercase">{group.section}</p>
              <ul className="space-y-0.5">
                {items.map((item) => {
                  const active = item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
                  const badge = counts && item.badge?.(counts);
                  return (
                    <li key={item.href}>
                      <Link
                        href={item.href}
                        onClick={onNavigate}
                        aria-current={active ? "page" : undefined}
                        className={cn(
                          "group relative flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors",
                          active ? "bg-primary-soft font-medium text-fg" : "text-muted hover:bg-glass-hover hover:text-fg",
                        )}
                      >
                        {active && <span className="absolute inset-y-2 left-0 w-0.5 rounded-full bg-primary" />}
                        <item.icon className={cn("size-4", active ? "text-primary-fg" : "text-subtle group-hover:text-muted")} />
                        <span className="flex-1">{item.label}</span>
                        {badge && (
                          <span className={cn("tabular rounded-md px-1.5 py-0.5 text-[10px] font-semibold", badge.tone === "crit" ? "bg-crit/15 text-crit" : "bg-primary-soft text-primary-fg")}>
                            {badge.value}
                          </span>
                        )}
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </div>
          );
        })}
      </nav>

      <div className="flex items-center gap-1 rounded-xl p-1">
        <Link href="/profile" onClick={onNavigate} className="flex min-w-0 flex-1 items-center gap-3 rounded-lg p-1.5 transition-colors hover:bg-glass-hover">
          <Avatar name={me?.name ?? "…"} />
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium">{me?.name ?? "Loading…"}</p>
            <p className="truncate text-[11px] text-subtle">{me ? `${me.roleName} · ${me.email}` : ""}</p>
          </div>
        </Link>
        <IconButton icon={LogOut} label="Sign out" onClick={signOut} />
      </div>
    </div>
  );
}

function ThemeToggle() {
  const [theme, setTheme] = useState<"dark" | "light">("dark");
  useEffect(() => {
    const current = document.documentElement.dataset.theme === "light" ? "light" : "dark";
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setTheme(current);
  }, []);
  function toggle() {
    const next = theme === "dark" ? "light" : "dark";
    setTheme(next);
    document.documentElement.dataset.theme = next;
    try {
      localStorage.setItem("theme", next);
    } catch {}
  }
  return <IconButton icon={theme === "dark" ? Sun : Moon} label={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"} onClick={toggle} />;
}

function LiveToggle() {
  const { paused, setPaused } = useLive();
  return (
    <button
      onClick={() => setPaused(!paused)}
      className="flex h-8 items-center gap-2 rounded-lg border border-line bg-inset px-2.5 text-xs font-medium text-muted transition-colors hover:text-fg"
      aria-pressed={!paused}
      title={paused ? "Resume live updates" : "Pause live updates"}
    >
      {paused ? (
        <>
          <span className="size-2 rounded-full bg-subtle" />
          Paused
          <Play className="size-3" />
        </>
      ) : (
        <>
          <span className="live-dot size-2 rounded-full bg-ok text-ok" />
          Live
          <Pause className="size-3" />
        </>
      )}
    </button>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const { me } = useMe();
  const { data: counts } = useApi<Counts>("/api/status", { interval: 15_000 });
  return (
    <div className="flex min-h-dvh">
      <aside className="glass sticky top-0 hidden h-dvh w-64 shrink-0 rounded-none border-y-0 border-l-0 lg:block">
        <Sidebar counts={counts} />
      </aside>

      {open && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={() => setOpen(false)} />
          <aside className="glass glass-strong absolute inset-y-0 left-0 w-72 rounded-none rounded-r-2xl">
            <IconButton icon={X} label="Close menu" className="absolute top-4 right-3" onClick={() => setOpen(false)} />
            <Sidebar counts={counts} onNavigate={() => setOpen(false)} />
          </aside>
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-40 border-b border-line bg-bg/60 backdrop-blur-xl">
          <div className="mx-auto flex h-14 max-w-[1600px] items-center gap-3 px-4 sm:px-6 lg:px-8">
            <IconButton icon={Menu} label="Open menu" className="lg:hidden" onClick={() => setOpen(true)} />
            <div className="ml-auto flex items-center gap-1.5">
              <LiveToggle />
              <ThemeToggle />
              <Link href="/alerts" className="relative grid size-8 place-items-center rounded-lg text-muted hover:bg-glass-hover hover:text-fg" aria-label={`${counts?.openAlerts ?? 0} open alerts`}>
                <Bell className="size-4" />
                {!!counts?.openAlerts && <span className={cn("absolute top-1.5 right-1.5 size-2 rounded-full ring-2 ring-bg", counts.criticalAlerts ? "bg-crit" : "bg-primary")} />}
              </Link>
              <Link href="/profile" className="ml-1" aria-label="Your profile">
                <Avatar name={me?.name ?? "…"} size="sm" />
              </Link>
            </div>
          </div>
        </header>
        <main className="mx-auto w-full max-w-[1600px] flex-1 px-4 py-6 sm:px-6 lg:px-8 lg:py-8">{children}</main>
      </div>
    </div>
  );
}
