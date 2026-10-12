"use client";

import { Check, CircleCheck, Copy, Database, HardDrive, KeyRound, Loader, Server, ShieldCheck, UserRound } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { AuthCard, FormError } from "@/components/auth-card";
import { useToast } from "@/components/providers";
import { Button, cn, Field, inputClass } from "@/components/ui";
import { api } from "@/lib/client";

type Step = "code" | "database" | "admin" | "organisation" | "done";
type Status = { step: Exclude<Step, "code">; codeOk: boolean; databaseFromEnv: boolean; database: { engine: string; target: string } | null; defaults: { sqlitePath: string } };

const STEPS: { id: Step; label: string; icon: typeof Database }[] = [
  { id: "code", label: "Verify", icon: KeyRound },
  { id: "database", label: "Database", icon: Database },
  { id: "admin", label: "Owner account", icon: UserRound },
  { id: "organisation", label: "Organisation", icon: Server },
];

function useSetupCode() {
  const [code, setCodeState] = useState("");
  useEffect(() => {
    try {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setCodeState(sessionStorage.getItem("ld-setup-code") ?? "");
    } catch {}
  }, []);
  const setCode = (c: string) => {
    setCodeState(c);
    try {
      sessionStorage.setItem("ld-setup-code", c);
    } catch {}
  };
  return [code, setCode] as const;
}

export function SetupView() {
  const [code, setCode] = useSetupCode();
  const [status, setStatus] = useState<Status | null>(null);
  const [step, setStep] = useState<Step>("code");
  const [finished, setFinished] = useState<{ token: string; installCommand: string } | null>(null);

  const refresh = useCallback(async (c: string) => {
    const s = await api<Status>("/api/setup/status", { headers: { "x-setup-code": c } });
    setStatus(s);
    if (s.step === "done") return void (window.location.href = "/");
    setStep(s.codeOk ? s.step : "code");
    return s;
  }, []);

  useEffect(() => {
    // State is only set after the request resolves.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    refresh(code).catch(() => {});
  }, [code, refresh]);

  const headers = { "x-setup-code": code };

  if (finished) return <Finished {...finished} />;

  return (
    <AuthCard title="Set up Linux Dash" subtitle="A few steps to connect a database and create your account." wide>
      <ol className="mb-8 grid grid-cols-4 gap-2">
        {STEPS.map((s, i) => {
          const idx = STEPS.findIndex((x) => x.id === step);
          const done = i < idx;
          const active = i === idx;
          return (
            <li key={s.id} className="flex flex-col items-center gap-1.5 text-center">
              <span className={cn("grid size-9 place-items-center rounded-full border text-sm transition-colors", done ? "border-ok/40 bg-ok/15 text-ok" : active ? "border-primary/60 bg-primary-soft text-primary-fg" : "border-line-strong text-subtle")}>
                {done ? <Check className="size-4" /> : <s.icon className="size-4" />}
              </span>
              <span className={cn("text-[11px] font-medium", active ? "text-fg" : "text-subtle")}>{s.label}</span>
            </li>
          );
        })}
      </ol>

      {!status ? (
        <p className="text-sm text-muted">Checking installation…</p>
      ) : step === "code" ? (
        <CodeStep
          onSubmit={async (c) => {
            const s = await refresh(c);
            if (!s?.codeOk) throw new Error("That code isn't right. Check the dashboard server's log output.");
            setCode(c);
          }}
        />
      ) : step === "database" ? (
        <DatabaseStep status={status} headers={headers} onDone={() => refresh(code)} />
      ) : step === "admin" ? (
        <AdminStep headers={headers} onDone={() => refresh(code)} />
      ) : (
        <OrganisationStep headers={headers} onDone={setFinished} />
      )}
    </AuthCard>
  );
}

function CodeStep({ onSubmit }: { onSubmit: (code: string) => Promise<void> }) {
  const [value, setValue] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <form
      className="space-y-4"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setError("");
        try {
          await onSubmit(value.trim().toUpperCase());
        } catch (err) {
          setError((err as Error).message);
        }
        setBusy(false);
      }}
    >
      <div className="flex gap-3 rounded-lg border border-line bg-inset p-3 text-sm text-muted">
        <ShieldCheck className="mt-0.5 size-4 shrink-0 text-primary-fg" />
        <p>
          To prove you control this server, enter the setup code printed in the dashboard&apos;s log when it started (it&apos;s also in <code className="font-mono text-xs text-fg">data/setup-code</code>).
        </p>
      </div>
      <FormError>{error}</FormError>
      <Field label="Setup code">
        <input className={cn(inputClass, "font-mono tracking-widest uppercase")} placeholder="XXXX-XXXX" autoFocus required value={value} onChange={(e) => setValue(e.target.value)} />
      </Field>
      <div className="flex justify-end">
        <Button variant="primary" type="submit" disabled={busy}>
          {busy ? "Checking…" : "Continue"}
        </Button>
      </div>
    </form>
  );
}

function DatabaseStep({ status, headers, onDone }: { status: Status; headers: Record<string, string>; onDone: () => void }) {
  const [engine, setEngine] = useState<"sqlite" | "postgres">("sqlite");
  const [sqlitePath, setSqlitePath] = useState(status.defaults.sqlitePath);
  const [pg, setPg] = useState({ host: "localhost", port: "5432", database: "linuxdash", user: "linuxdash", password: "", ssl: "disable", url: "" });
  const [useUrl, setUseUrl] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; error?: string; version?: string; target?: string; tables?: string[] } | null>(null);
  const [busy, setBusy] = useState<"test" | "save" | null>(null);

  const body = (action: "test" | "save") =>
    engine === "sqlite"
      ? { action, engine, sqlitePath }
      : { action, engine, ssl: pg.ssl, ...(useUrl ? { url: pg.url } : { host: pg.host, port: Number(pg.port), database: pg.database, user: pg.user, password: pg.password }) };

  async function run(action: "test" | "save") {
    setBusy(action);
    setResult(null);
    try {
      setResult(await api("/api/setup/database", { body: body(action), headers }));
    } catch (err) {
      setResult({ ok: false, error: (err as Error).message });
    }
    setBusy(null);
  }

  if (result?.tables) {
    return (
      <div className="space-y-4">
        <div className="flex items-center gap-2 text-sm text-ok">
          <CircleCheck className="size-4" />
          Connected to {result.version} and created {result.tables.length} tables.
        </div>
        <ul className="grid grid-cols-2 gap-x-4 gap-y-1 rounded-lg border border-line bg-inset p-3 font-mono text-xs text-muted sm:grid-cols-3">
          {result.tables.map((t) => (
            <li key={t} className="flex items-center gap-1.5">
              <Check className="size-3 text-ok" />
              {t}
            </li>
          ))}
        </ul>
        <div className="flex justify-end">
          <Button variant="primary" onClick={onDone}>
            Continue
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {status.databaseFromEnv ? (
        <div className="rounded-lg border border-line bg-inset p-3 text-sm">
          <p className="font-medium">Using DATABASE_URL from the environment</p>
          <p className="mt-0.5 font-mono text-xs text-muted">
            {status.database?.engine}: {status.database?.target}
          </p>
        </div>
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-2">
            {[
              { id: "sqlite" as const, icon: HardDrive, title: "SQLite", text: "A single file on this server. No setup; good for small fleets." },
              { id: "postgres" as const, icon: Database, title: "PostgreSQL", text: "Recommended for production and larger fleets." },
            ].map((o) => (
              <button
                key={o.id}
                type="button"
                onClick={() => {
                  setEngine(o.id);
                  setResult(null);
                }}
                className={cn("rounded-xl border p-4 text-left transition-colors", engine === o.id ? "border-primary/60 bg-primary-soft ring-1 ring-primary/30" : "border-line-strong bg-inset hover:border-primary/40")}
              >
                <div className="flex items-center gap-2 font-medium">
                  <o.icon className="size-4 text-primary-fg" />
                  {o.title}
                </div>
                <p className="mt-1 text-xs text-muted">{o.text}</p>
              </button>
            ))}
          </div>

          {engine === "sqlite" ? (
            <Field label="Database file" hint="Created if it doesn't exist. Keep it on persistent storage and include it in backups.">
              <input className={cn(inputClass, "font-mono text-xs")} value={sqlitePath} onChange={(e) => setSqlitePath(e.target.value)} />
            </Field>
          ) : (
            <div className="space-y-4">
              <label className="flex items-center gap-2 text-xs text-muted">
                <input type="checkbox" checked={useUrl} onChange={(e) => setUseUrl(e.target.checked)} className="accent-[var(--primary)]" />
                Paste a connection URL instead
              </label>
              {useUrl ? (
                <Field label="Connection URL">
                  <input className={cn(inputClass, "font-mono text-xs")} placeholder="postgres://user:password@host:5432/linuxdash" value={pg.url} onChange={(e) => setPg({ ...pg, url: e.target.value })} />
                </Field>
              ) : (
                <div className="grid gap-4 sm:grid-cols-6">
                  <div className="sm:col-span-4">
                    <Field label="Host">
                      <input className={inputClass} value={pg.host} onChange={(e) => setPg({ ...pg, host: e.target.value })} />
                    </Field>
                  </div>
                  <div className="sm:col-span-2">
                    <Field label="Port">
                      <input className={inputClass} inputMode="numeric" value={pg.port} onChange={(e) => setPg({ ...pg, port: e.target.value })} />
                    </Field>
                  </div>
                  <div className="sm:col-span-2">
                    <Field label="Database">
                      <input className={inputClass} value={pg.database} onChange={(e) => setPg({ ...pg, database: e.target.value })} />
                    </Field>
                  </div>
                  <div className="sm:col-span-2">
                    <Field label="User">
                      <input className={inputClass} value={pg.user} onChange={(e) => setPg({ ...pg, user: e.target.value })} />
                    </Field>
                  </div>
                  <div className="sm:col-span-2">
                    <Field label="Password">
                      <input className={inputClass} type="password" value={pg.password} onChange={(e) => setPg({ ...pg, password: e.target.value })} />
                    </Field>
                  </div>
                </div>
              )}
              <Field label="TLS">
                <select className={inputClass} value={pg.ssl} onChange={(e) => setPg({ ...pg, ssl: e.target.value })}>
                  <option value="disable">Off (local or private network)</option>
                  <option value="require">Required (encrypt, don&apos;t verify certificate)</option>
                  <option value="verify-full">Required and verify certificate</option>
                </select>
              </Field>
              <p className="text-xs text-subtle">The database must already exist and the user needs permission to create tables. Tables are created automatically.</p>
            </div>
          )}
        </>
      )}

      {result && !result.ok && <FormError>Couldn&apos;t connect: {result.error}</FormError>}
      {result?.ok && !result.tables && (
        <p className="flex items-center gap-2 text-sm text-ok">
          <CircleCheck className="size-4" /> Connected to {result.version}
        </p>
      )}

      <div className="flex flex-wrap justify-end gap-2">
        <Button onClick={() => run("test")} disabled={!!busy}>
          {busy === "test" ? <Loader className="size-4 animate-spin" /> : null}
          Test connection
        </Button>
        <Button variant="primary" onClick={() => run("save")} disabled={!!busy}>
          {busy === "save" ? <Loader className="size-4 animate-spin" /> : null}
          Create tables &amp; continue
        </Button>
      </div>
    </div>
  );
}

function AdminStep({ headers, onDone }: { headers: Record<string, string>; onDone: () => void }) {
  const [f, setF] = useState({ name: "", email: "", password: "", confirm: "" });
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <form
      className="space-y-4"
      onSubmit={async (e) => {
        e.preventDefault();
        if (f.password !== f.confirm) return setError("The passwords don't match");
        setBusy(true);
        setError("");
        try {
          await api("/api/setup/admin", { body: { name: f.name, email: f.email, password: f.password }, headers });
          onDone();
        } catch (err) {
          setError((err as Error).message);
          setBusy(false);
        }
      }}
    >
      <p className="text-sm text-muted">This account is the owner: it has every permission and can invite your team.</p>
      <FormError>{error}</FormError>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Your name">
          <input className={inputClass} required autoFocus value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
        </Field>
        <Field label="Email">
          <input className={inputClass} type="email" autoComplete="username" required value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} />
        </Field>
        <Field label="Password" hint="At least 10 characters">
          <input className={inputClass} type="password" autoComplete="new-password" minLength={10} required value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} />
        </Field>
        <Field label="Confirm password">
          <input className={inputClass} type="password" autoComplete="new-password" required value={f.confirm} onChange={(e) => setF({ ...f, confirm: e.target.value })} />
        </Field>
      </div>
      <div className="flex justify-end">
        <Button variant="primary" type="submit" disabled={busy}>
          {busy ? "Creating…" : "Create owner account"}
        </Button>
      </div>
    </form>
  );
}

function OrganisationStep({ headers, onDone }: { headers: Record<string, string>; onDone: (r: { token: string; installCommand: string }) => void }) {
  const [orgName, setOrgName] = useState("");
  const [publicUrl, setPublicUrl] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setPublicUrl(window.location.origin);
  }, []);
  return (
    <form
      className="space-y-4"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setError("");
        try {
          onDone(await api("/api/setup/organisation", { body: { orgName, publicUrl }, headers }));
        } catch (err) {
          setError((err as Error).message);
          setBusy(false);
        }
      }}
    >
      <FormError>{error}</FormError>
      <Field label="Organisation name">
        <input className={inputClass} required autoFocus placeholder="Acme Ltd" value={orgName} onChange={(e) => setOrgName(e.target.value)} />
      </Field>
      <Field label="Dashboard address for agents" hint="The URL your servers use to reach this dashboard, e.g. https://dash.example.com or http://10.0.0.5:3000. Agents connect out to it.">
        <input className={cn(inputClass, "font-mono text-xs")} required value={publicUrl} onChange={(e) => setPublicUrl(e.target.value)} />
      </Field>
      <div className="flex justify-end">
        <Button variant="primary" type="submit" disabled={busy}>
          {busy ? "Finishing…" : "Finish setup"}
        </Button>
      </div>
    </form>
  );
}

function Finished({ token, installCommand }: { token: string; installCommand: string }) {
  const { toast } = useToast();
  const copy = (s: string) => navigator.clipboard?.writeText(s).then(() => toast({ title: "Copied", tone: "success" }), () => {});
  return (
    <AuthCard title="You're all set" subtitle="Add your first server by running this on it as root. The installer asks for anything else it needs." wide>
      <div className="space-y-4">
        <div className="flex items-center gap-2 rounded-lg border border-line bg-inset p-3">
          <code className="min-w-0 flex-1 overflow-x-auto font-mono text-[11px] whitespace-nowrap text-muted scrollbar-thin">{installCommand}</code>
          <Button size="sm" variant="ghost" icon={Copy} onClick={() => copy(installCommand)}>
            Copy
          </Button>
        </div>
        <p className="text-xs text-subtle">
          This enrolment token (<code className="font-mono">{token.slice(0, 10)}…</code>) adds servers to <b>Production</b> and expires in 30 days. It&apos;s only shown once; you can create more under Settings → Agent enrolment.
        </p>
        <div className="flex justify-end">
          <Button variant="primary" onClick={() => (window.location.href = "/")}>
            Go to the dashboard
          </Button>
        </div>
      </div>
    </AuthCard>
  );
}
