"use client";

import { Bell, Building2, Database, KeyRound, Send, ShieldAlert, Timer } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { useToast } from "@/components/providers";
import { Badge, Button, Card, CardHeader, EmptyNote, Field, inputClass, PageHeader, Toggle } from "@/components/ui";
import { api, useApi, useMe } from "@/lib/client";

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

export function SettingsView() {
  const { can } = useMe();
  return (
    <div className="space-y-6">
      <PageHeader title="Settings" description="Organisation, database, data retention, vulnerability scanning and notifications." />
      {can("servers.manage") && (
        <Card className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center">
          <KeyRound className="size-5 shrink-0 text-primary-fg" />
          <p className="flex-1 text-sm text-muted">Agent enrolment tokens, agent versions and each agent&apos;s configuration now live on the Agents page.</p>
          <Link href="/agents">
            <Button size="sm">Open Agents</Button>
          </Link>
        </Card>
      )}
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
