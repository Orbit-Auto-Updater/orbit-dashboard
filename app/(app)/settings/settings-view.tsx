"use client";

import { Bell, Building2, Copy, Database, KeyRound, Plus, Send, ShieldAlert, Timer, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { Modal, useConfirm, useToast } from "@/components/providers";
import { Badge, Button, Card, CardHeader, EmptyNote, EnvBadge, Field, IconButton, inputClass, PageHeader, Table, Toggle, type Env } from "@/components/ui";
import { ago, api, dateTime, useApi, useMe } from "@/lib/client";

type Settings = {
  orgName: string;
  publicUrl: string;
  metricsRetentionDays: number;
  logsRetentionDays: number;
  cveScanEnabled: boolean;
  cveScanIntervalHours: number;
  webhookUrl: string;
  webhookMinSeverity: "critical" | "warning" | "info";
  database: { engine: string; target: string; fromEnv: boolean; version: string; rows: Record<string, number> };
};
type Token = { id: string; label: string; token_prefix: string; environment: string; created_at: number; expires_at: number | null; max_uses: number | null; uses: number; revoked: boolean; expired: boolean; last_used_at: number | null };

export function SettingsView() {
  const { can } = useMe();
  return (
    <div className="space-y-6">
      <PageHeader title="Settings" description="Organisation, agent enrolment, data retention, vulnerability scanning and notifications." />
      {can("servers.manage") && <Enrolment />}
      {can("org.settings") ? <OrgSettings /> : <EmptyNote>Organisation settings need the “Organisation settings” permission.</EmptyNote>}
    </div>
  );
}

function OrgSettings() {
  const { toast } = useToast();
  const { data, reload } = useApi<Settings>("/api/settings", { interval: false });
  const [f, setF] = useState<Settings | null>(null);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (data) setF(data);
  }, [data]);
  if (!f || !data) return <p className="text-sm text-muted">Loading…</p>;

  async function save(e?: React.FormEvent) {
    e?.preventDefault();
    try {
      const { database, ...body } = f!;
      void database;
      await api("/api/settings", { method: "PUT", body });
      toast({ title: "Settings saved", tone: "success" });
      reload();
    } catch (err) {
      toast({ title: "Couldn't save settings", body: (err as Error).message, tone: "error" });
    }
  }

  async function testWebhook() {
    try {
      await save();
      await api("/api/settings/webhook-test", { body: {} });
      toast({ title: "Test notification sent", tone: "success" });
    } catch (err) {
      toast({ title: "Webhook test failed", body: (err as Error).message, tone: "error" });
    }
  }

  const db = data.database;
  return (
    <form onSubmit={save} className="grid gap-4 xl:grid-cols-2">
      <Card>
        <CardHeader icon={Building2} title="Organisation" />
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Organisation name">
            <input className={inputClass} value={f.orgName} onChange={(e) => setF({ ...f, orgName: e.target.value })} />
          </Field>
          <Field label="Dashboard address for agents" hint="Used in install commands and invite links">
            <input className={`${inputClass} font-mono text-xs`} value={f.publicUrl} onChange={(e) => setF({ ...f, publicUrl: e.target.value })} placeholder="https://dash.example.com" />
          </Field>
        </div>
      </Card>

      <Card>
        <CardHeader icon={Database} title="Database" subtitle={db.fromEnv ? "Configured with DATABASE_URL" : "Configured in the setup wizard"} action={<Badge tone="ok">Connected</Badge>} />
        <dl className="space-y-2 text-xs">
          {[
            ["Engine", db.version],
            ["Location", db.target],
            ["Servers", db.rows.servers],
            ["Metric samples", db.rows.metrics.toLocaleString()],
            ["Log entries", db.rows.logs.toLocaleString()],
            ["Users", db.rows.users],
          ].map(([k, v]) => (
            <div key={k} className="flex justify-between gap-3">
              <dt className="text-subtle">{k}</dt>
              <dd className="truncate text-right font-mono">{v}</dd>
            </div>
          ))}
        </dl>
        <p className="mt-3 text-[11px] text-subtle">To move to another database, set DATABASE_URL and restart; tables are created automatically.</p>
      </Card>

      <Card>
        <CardHeader icon={Timer} title="Data retention" />
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Metric history (days)" hint="10-second samples used for the charts">
            <input type="number" min={1} max={365} className={inputClass} value={f.metricsRetentionDays} onChange={(e) => setF({ ...f, metricsRetentionDays: Number(e.target.value) })} />
          </Field>
          <Field label="Logs (days)">
            <input type="number" min={1} max={365} className={inputClass} value={f.logsRetentionDays} onChange={(e) => setF({ ...f, logsRetentionDays: Number(e.target.value) })} />
          </Field>
        </div>
      </Card>

      <Card>
        <CardHeader icon={ShieldAlert} title="Vulnerability scanning" subtitle="Pending packages are checked against OSV.dev; package names and versions are sent, nothing else" />
        <div className="space-y-4">
          <div className="flex items-center justify-between rounded-lg border border-line bg-inset p-3">
            <div>
              <p className="text-sm font-medium">Scan automatically</p>
              <p className="text-xs text-subtle">Also runs whenever a server reports new pending packages</p>
            </div>
            <Toggle label="Scan automatically" defaultChecked={f.cveScanEnabled} onChange={(v) => setF({ ...f, cveScanEnabled: v })} />
          </div>
          <Field label="Full rescan every (hours)">
            <input type="number" min={1} max={168} className={inputClass} value={f.cveScanIntervalHours} onChange={(e) => setF({ ...f, cveScanIntervalHours: Number(e.target.value) })} />
          </Field>
        </div>
      </Card>

      <Card className="xl:col-span-2">
        <CardHeader icon={Bell} title="Notifications" subtitle="New alerts are POSTed as JSON with a Slack-compatible “text” field (Slack, Mattermost, Discord /slack, Teams workflows, or your own endpoint)" />
        <div className="grid gap-4 sm:grid-cols-[1fr_200px_auto] sm:items-end">
          <Field label="Webhook URL">
            <input className={`${inputClass} font-mono text-xs`} placeholder="https://hooks.slack.com/services/…" value={f.webhookUrl} onChange={(e) => setF({ ...f, webhookUrl: e.target.value })} />
          </Field>
          <Field label="Notify for">
            <select className={inputClass} value={f.webhookMinSeverity} onChange={(e) => setF({ ...f, webhookMinSeverity: e.target.value as Settings["webhookMinSeverity"] })}>
              <option value="critical">Critical only</option>
              <option value="warning">Warning and critical</option>
              <option value="info">Everything</option>
            </select>
          </Field>
          <Button icon={Send} onClick={testWebhook} disabled={!f.webhookUrl}>
            Send test
          </Button>
        </div>
      </Card>

      <div className="flex justify-end xl:col-span-2">
        <Button variant="primary" type="submit">
          Save settings
        </Button>
      </div>
    </form>
  );
}

function Enrolment() {
  const { toast } = useToast();
  const confirm = useConfirm();
  const { data, reload } = useApi<{ tokens: Token[]; publicUrl: string }>("/api/enrollment-tokens", { interval: 30_000 });
  const [creating, setCreating] = useState(false);
  const [created, setCreated] = useState<{ token: string; installCommand: string } | null>(null);

  async function revoke(t: Token) {
    if (!(await confirm({ title: `Revoke “${t.label}”?`, body: "Servers already enrolled keep working; the token can't enrol new ones.", confirmLabel: "Revoke", danger: true }))) return;
    await api(`/api/enrollment-tokens/${t.id}`, { method: "DELETE" }).catch((err) => toast({ title: "Couldn't revoke", body: (err as Error).message, tone: "error" }));
    reload();
  }

  const active = (data?.tokens ?? []).filter((t) => !t.revoked && !t.expired);
  return (
    <Card>
      <div id="enrolment" className="scroll-mt-24" />
      <CardHeader
        icon={KeyRound}
        title="Agent enrolment"
        subtitle="Create a token, then run the install command on each server as root"
        action={
          <Button size="sm" variant="primary" icon={Plus} onClick={() => setCreating(true)}>
            New token
          </Button>
        }
      />
      <div className="mb-4 rounded-lg border border-line bg-inset p-3 text-xs text-muted">
        <p>
          Install command: <code className="font-mono text-fg">curl -fsSL {data?.publicUrl ?? "…"}/install.sh | sudo sh -s -- --token &lt;TOKEN&gt;</code>
        </p>
        <p className="mt-1 text-subtle">
          The installer asks for anything else (what to monitor, reboots, auto-updates). Agent binaries are served from <code className="font-mono">/downloads</code>; build them with <code className="font-mono">make release</code> in linux-dash-agent and copy <code className="font-mono">dist/</code> to the dashboard&apos;s data/agent directory (or set AGENT_DIST_DIR).
        </p>
      </div>
      {!data ? (
        <p className="text-sm text-muted">Loading…</p>
      ) : data.tokens.length === 0 ? (
        <EmptyNote>No tokens yet.</EmptyNote>
      ) : (
        <Table>
          <thead>
            <tr>
              <th>Token</th>
              <th>Environment</th>
              <th>Uses</th>
              <th>Expires</th>
              <th>Last used</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {data.tokens.map((t) => (
              <tr key={t.id} className={t.revoked || t.expired ? "opacity-50" : ""}>
                <td>
                  <p className="font-medium">{t.label}</p>
                  <p className="font-mono text-[11px] text-subtle">{t.token_prefix}…</p>
                </td>
                <td>
                  <EnvBadge env={t.environment as Env} />
                </td>
                <td className="tabular text-muted">
                  {t.uses}
                  {t.max_uses ? ` / ${t.max_uses}` : ""}
                </td>
                <td className="text-muted">{t.revoked ? <Badge>revoked</Badge> : t.expired ? <Badge>expired</Badge> : t.expires_at ? dateTime(t.expires_at) : "Never"}</td>
                <td className="text-muted">{ago(t.last_used_at)}</td>
                <td className="text-right">{!t.revoked && <IconButton icon={Trash2} label={`Revoke ${t.label}`} onClick={() => revoke(t)} />}</td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
      {active.length === 0 && data && data.tokens.length > 0 && <p className="mt-3 text-xs text-warn">No active tokens; create one to enrol more servers.</p>}

      {creating && (
        <NewToken
          onClose={() => setCreating(false)}
          onCreated={(r) => {
            setCreating(false);
            setCreated(r);
            reload();
          }}
        />
      )}
      {created && (
        <Modal title="Token created" onClose={() => setCreated(null)} icon={KeyRound} wide>
          <p className="text-sm text-muted">Copy it now; it won&apos;t be shown again. Run this on each server as root:</p>
          <div className="mt-4 flex items-center gap-2 rounded-lg border border-line bg-inset p-3">
            <code className="min-w-0 flex-1 overflow-x-auto font-mono text-[11px] whitespace-nowrap scrollbar-thin">{created.installCommand}</code>
            <Button size="sm" variant="ghost" icon={Copy} onClick={() => navigator.clipboard?.writeText(created.installCommand).then(() => toast({ title: "Copied", tone: "success" }))}>
              Copy
            </Button>
          </div>
          <div className="mt-6 flex justify-end">
            <Button variant="primary" onClick={() => setCreated(null)}>
              Done
            </Button>
          </div>
        </Modal>
      )}
    </Card>
  );
}

function NewToken({ onClose, onCreated }: { onClose: () => void; onCreated: (r: { token: string; installCommand: string }) => void }) {
  const { toast } = useToast();
  const [f, setF] = useState({ label: "", environment: "production", expiresInDays: 7, maxUses: 0 });
  return (
    <Modal title="New enrolment token" onClose={onClose} icon={KeyRound}>
      <form
        className="space-y-4"
        onSubmit={async (e) => {
          e.preventDefault();
          try {
            onCreated(await api("/api/enrollment-tokens", { body: { ...f, maxUses: f.maxUses || null, expiresInDays: f.expiresInDays || null } }));
          } catch (err) {
            toast({ title: "Couldn't create token", body: (err as Error).message, tone: "error" });
          }
        }}
      >
        <Field label="Label">
          <input className={inputClass} required autoFocus placeholder="e.g. web servers, Oct 2026" value={f.label} onChange={(e) => setF({ ...f, label: e.target.value })} />
        </Field>
        <Field label="Environment" hint="Servers enrolled with this token join this environment (and its update policy)">
          <select className={inputClass} value={f.environment} onChange={(e) => setF({ ...f, environment: e.target.value })}>
            <option value="production">Production</option>
            <option value="staging">Staging</option>
            <option value="development">Development</option>
          </select>
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Expires after (days)" hint="0 = never">
            <input type="number" min={0} max={365} className={inputClass} value={f.expiresInDays} onChange={(e) => setF({ ...f, expiresInDays: Number(e.target.value) })} />
          </Field>
          <Field label="Maximum servers" hint="0 = unlimited">
            <input type="number" min={0} max={10000} className={inputClass} value={f.maxUses} onChange={(e) => setF({ ...f, maxUses: Number(e.target.value) })} />
          </Field>
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" type="submit">
            Create token
          </Button>
        </div>
      </form>
    </Modal>
  );
}
