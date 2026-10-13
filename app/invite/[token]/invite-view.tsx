"use client";

import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { AuthCard, FormError } from "@/components/auth-card";
import { Button, Field, inputClass } from "@/components/ui";
import { api } from "@/lib/client";

export function InviteView() {
  const { token } = useParams<{ token: string }>();
  const [invite, setInvite] = useState<{ name: string; email: string; orgName: string } | null>(null);
  const [loadError, setLoadError] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api<{ name: string; email: string; orgName: string }>(`/api/invite/${encodeURIComponent(token)}`).then(setInvite, (e) => setLoadError((e as Error).message));
  }, [token]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (password !== confirm) return setError("The passwords don't match");
    setBusy(true);
    setError("");
    try {
      await api(`/api/invite/${encodeURIComponent(token)}`, { body: { password } });
      window.location.href = "/";
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  if (loadError) return <AuthCard title="Invite not valid"><FormError>{loadError}</FormError></AuthCard>;
  if (!invite) return <AuthCard title="Loading invite…"><p className="text-sm text-muted">One moment.</p></AuthCard>;
  return (
    <AuthCard title={`Join ${invite.orgName || "Orbit"}`} subtitle={<>Welcome, {invite.name}. Choose a password for <span className="text-fg">{invite.email}</span>.</>}>
      <form onSubmit={submit} className="space-y-4">
        <FormError>{error}</FormError>
        <Field label="Password" hint="At least 10 characters">
          <input className={inputClass} type="password" autoComplete="new-password" minLength={10} required value={password} onChange={(e) => setPassword(e.target.value)} />
        </Field>
        <Field label="Confirm password">
          <input className={inputClass} type="password" autoComplete="new-password" required value={confirm} onChange={(e) => setConfirm(e.target.value)} />
        </Field>
        <Button variant="primary" className="w-full" disabled={busy} type="submit">
          {busy ? "Setting up…" : "Create account"}
        </Button>
      </form>
    </AuthCard>
  );
}
