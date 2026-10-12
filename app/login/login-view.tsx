"use client";

import { LogIn } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { useState } from "react";
import { AuthCard, FormError } from "@/components/auth-card";
import { Button, Field, inputClass } from "@/components/ui";
import { api } from "@/lib/client";

export function LoginView() {
  const next = useSearchParams().get("next");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      await api("/api/auth/login", { body: { email, password } });
      // Only follow same-site relative paths.
      window.location.href = next && next.startsWith("/") && !next.startsWith("//") ? next : "/";
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  return (
    <AuthCard title="Sign in" subtitle="Use the account your administrator created for you.">
      <form onSubmit={submit} className="space-y-4">
        <FormError>{error}</FormError>
        <Field label="Email">
          <input className={inputClass} type="email" autoComplete="username" required autoFocus value={email} onChange={(e) => setEmail(e.target.value)} />
        </Field>
        <Field label="Password">
          <input className={inputClass} type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
        </Field>
        <Button variant="primary" icon={LogIn} className="w-full" disabled={busy} type="submit">
          {busy ? "Signing in…" : "Sign in"}
        </Button>
      </form>
    </AuthCard>
  );
}
