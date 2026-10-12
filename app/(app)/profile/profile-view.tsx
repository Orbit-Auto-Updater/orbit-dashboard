"use client";

import { KeyRound, Laptop, LogOut, ShieldCheck, UserRound } from "lucide-react";
import { useEffect, useState } from "react";
import { useToast } from "@/components/providers";
import { Avatar, Badge, Button, Card, CardHeader, Field, inputClass, PageHeader } from "@/components/ui";
import { ago, api, dateTime, useApi, useMe } from "@/lib/client";
import { PERMISSION_LIST } from "@/lib/permissions";

type Session = { id: string; created_at: number; last_seen_at: number; ip: string | null; user_agent: string | null; current: boolean };

function device(ua: string | null) {
  if (!ua) return "Unknown device";
  const browser = /Edg\//.test(ua) ? "Edge" : /Firefox\//.test(ua) ? "Firefox" : /Chrome\//.test(ua) ? "Chrome" : /Safari\//.test(ua) ? "Safari" : /curl|Go-http/.test(ua) ? "Script" : "Browser";
  const os = /Windows/.test(ua) ? "Windows" : /Mac OS X/.test(ua) ? "macOS" : /Android/.test(ua) ? "Android" : /iPhone|iPad/.test(ua) ? "iOS" : /Linux/.test(ua) ? "Linux" : "";
  return os ? `${browser} on ${os}` : browser;
}

export function ProfileView() {
  const { me, reload } = useMe();
  const { toast } = useToast();
  const [f, setF] = useState({ name: "", email: "", timezone: "" });
  const [pw, setPw] = useState({ current: "", next: "", confirm: "" });
  const sessions = useApi<{ sessions: Session[] }>("/api/me/sessions", { interval: 60_000 });
  const zones = typeof Intl.supportedValuesOf === "function" ? Intl.supportedValuesOf("timeZone") : [];

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (me) setF({ name: me.name, email: me.email, timezone: me.timezone ?? "" });
  }, [me]);

  if (!me) return <p className="text-sm text-muted">Loading…</p>;

  async function saveProfile(e: React.FormEvent) {
    e.preventDefault();
    try {
      await api("/api/me", { method: "PATCH", body: f });
      toast({ title: "Profile saved", tone: "success" });
      reload();
    } catch (err) {
      toast({ title: "Couldn't save profile", body: (err as Error).message, tone: "error" });
    }
  }

  async function changePassword(e: React.FormEvent) {
    e.preventDefault();
    if (pw.next !== pw.confirm) return toast({ title: "The new passwords don't match", tone: "error" });
    try {
      await api("/api/me/password", { body: { current: pw.current, next: pw.next } });
      setPw({ current: "", next: "", confirm: "" });
      toast({ title: "Password changed", body: "Your other sessions were signed out.", tone: "success" });
      sessions.reload();
    } catch (err) {
      toast({ title: "Couldn't change password", body: (err as Error).message, tone: "error" });
    }
  }

  async function revoke(id?: string) {
    try {
      await api(id ? `/api/me/sessions/${encodeURIComponent(id)}` : "/api/me/sessions", { method: "DELETE" });
      toast({ title: id ? "Session signed out" : "Other sessions signed out", tone: "success" });
      sessions.reload();
    } catch (err) {
      toast({ title: "Couldn't sign out session", body: (err as Error).message, tone: "error" });
    }
  }

  const granted = new Set(me.permissions);

  return (
    <div className="space-y-6">
      <PageHeader title="Profile" description="Your account, password and signed-in sessions." />

      <div className="grid gap-4 xl:grid-cols-3">
        <Card>
          <div className="flex flex-col items-center text-center">
            <Avatar name={me.name} size="lg" />
            <p className="mt-3 text-lg font-semibold">{me.name}</p>
            <p className="text-sm text-muted">{me.email}</p>
            <div className="mt-3">
              <Badge tone="primary">{me.roleName}</Badge>
            </div>
          </div>
          <div className="mt-6 border-t border-line pt-4">
            <p className="mb-2 text-xs font-medium text-muted">What your role allows</p>
            <ul className="space-y-1 text-xs">
              {PERMISSION_LIST.map((p) => (
                <li key={p.key} className={granted.has(p.key) ? "text-fg" : "text-subtle line-through"}>
                  {p.label}
                </li>
              ))}
            </ul>
            {me.createdAt && <p className="mt-4 text-[11px] text-subtle">Member since {dateTime(me.createdAt)}</p>}
          </div>
        </Card>

        <div className="space-y-4 xl:col-span-2">
          <Card>
            <CardHeader icon={UserRound} title="Personal details" />
            <form className="grid gap-4 sm:grid-cols-2" onSubmit={saveProfile}>
              <Field label="Full name">
                <input className={inputClass} required value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
              </Field>
              <Field label="Email" hint="Used to sign in">
                <input className={inputClass} type="email" required value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} />
              </Field>
              <Field label="Timezone">
                <select className={inputClass} value={f.timezone} onChange={(e) => setF({ ...f, timezone: e.target.value })}>
                  <option value="">Browser default</option>
                  {zones.map((z) => (
                    <option key={z}>{z}</option>
                  ))}
                </select>
              </Field>
              <div className="flex items-end justify-end">
                <Button variant="primary" type="submit">
                  Save changes
                </Button>
              </div>
            </form>
          </Card>

          <Card>
            <CardHeader icon={KeyRound} title="Change password" />
            <form className="grid gap-4 sm:grid-cols-3" onSubmit={changePassword}>
              <Field label="Current password">
                <input className={inputClass} type="password" autoComplete="current-password" required value={pw.current} onChange={(e) => setPw({ ...pw, current: e.target.value })} />
              </Field>
              <Field label="New password" hint="At least 10 characters">
                <input className={inputClass} type="password" autoComplete="new-password" minLength={10} required value={pw.next} onChange={(e) => setPw({ ...pw, next: e.target.value })} />
              </Field>
              <Field label="Confirm new password">
                <input className={inputClass} type="password" autoComplete="new-password" required value={pw.confirm} onChange={(e) => setPw({ ...pw, confirm: e.target.value })} />
              </Field>
              <div className="flex justify-end sm:col-span-3">
                <Button variant="primary" type="submit">
                  Change password
                </Button>
              </div>
            </form>
          </Card>

          <Card>
            <CardHeader
              icon={ShieldCheck}
              title="Signed-in sessions"
              action={
                (sessions.data?.sessions.length ?? 0) > 1 && (
                  <Button size="sm" variant="danger" icon={LogOut} onClick={() => revoke()}>
                    Sign out others
                  </Button>
                )
              }
            />
            <ul className="space-y-2">
              {sessions.data?.sessions.map((s) => (
                <li key={s.id} className="flex items-center gap-3 rounded-lg border border-line bg-inset p-3">
                  <Laptop className="size-4 text-subtle" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{device(s.user_agent)}</p>
                    <p className="text-[11px] text-subtle">
                      {s.ip ?? "unknown IP"} · signed in {ago(s.created_at)} · active {ago(s.last_seen_at)}
                    </p>
                  </div>
                  {s.current ? (
                    <Badge tone="ok">This device</Badge>
                  ) : (
                    <Button size="sm" variant="ghost" onClick={() => revoke(s.id)}>
                      Sign out
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          </Card>
        </div>
      </div>
    </div>
  );
}
