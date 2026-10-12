"use client";

import { Check, Copy, KeyRound, Link2, Minus, Plus, Search, Trash2, UserPlus } from "lucide-react";
import { useState } from "react";
import { Modal, useConfirm, useToast } from "@/components/providers";
import { Avatar, Badge, Button, Card, cn, EmptyNote, Field, IconButton, inputClass, PageHeader, Segmented, StatusBadge, Table, type Tone } from "@/components/ui";
import { ago, api, isPast, useApi, useMe } from "@/lib/client";
import { PERMISSION_GROUPS } from "@/lib/permissions";

type User = { id: string; name: string; email: string; role_id: string; role_name: string; status: "active" | "invited" | "suspended"; invite_expires_at: number | null; created_at: number; last_active_at: number | null };
type Role = { id: string; name: string; description: string; builtin: boolean; members: number; permissions: string[] };

const roleTone = (id: string): Tone => ({ owner: "primary", admin: "info", operator: "ok", viewer: "neutral" })[id] as Tone ?? "warn";

export function UsersView() {
  const { me, can } = useMe();
  const { toast } = useToast();
  const confirm = useConfirm();
  const [tab, setTab] = useState<"users" | "roles">("users");
  const [q, setQ] = useState("");
  const [inviting, setInviting] = useState(false);
  const [link, setLink] = useState<{ name: string; url: string } | null>(null);
  const users = useApi<{ users: User[] }>("/api/users", { interval: 30_000 });
  const roles = useApi<{ roles: Role[] }>("/api/roles", { interval: 30_000 });

  if (users.error && !users.data) return <EmptyNote>{users.error.message}</EmptyNote>;
  const list = (users.data?.users ?? []).filter((u) => q === "" || `${u.name} ${u.email} ${u.role_name}`.toLowerCase().includes(q.toLowerCase()));
  const roleList = roles.data?.roles ?? [];

  async function patch(u: User, body: Record<string, unknown>, ok: string) {
    try {
      await api(`/api/users/${u.id}`, { method: "PATCH", body });
      toast({ title: ok, tone: "success" });
      users.reload();
      roles.reload();
    } catch (err) {
      toast({ title: "Couldn't update user", body: (err as Error).message, tone: "error" });
      users.reload();
    }
  }

  async function remove(u: User) {
    if (!(await confirm({ title: `Remove ${u.name}?`, body: "They're signed out and can no longer access the dashboard. Their audit history is kept.", confirmLabel: "Remove", danger: true }))) return;
    try {
      await api(`/api/users/${u.id}`, { method: "DELETE" });
      toast({ title: `${u.name} removed`, tone: "success" });
      users.reload();
      roles.reload();
    } catch (err) {
      toast({ title: "Couldn't remove user", body: (err as Error).message, tone: "error" });
    }
  }

  async function resend(u: User) {
    try {
      const r = await api<{ inviteUrl: string }>(`/api/users/${u.id}/invite`, { body: {} });
      setLink({ name: u.name, url: r.inviteUrl });
      users.reload();
    } catch (err) {
      toast({ title: "Couldn't create invite link", body: (err as Error).message, tone: "error" });
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Users & roles"
        description="Control who can view, operate and administer the fleet."
        actions={
          <Button variant="primary" icon={UserPlus} onClick={() => setInviting(true)}>
            Invite user
          </Button>
        }
      />

      <Segmented value={tab} onChange={setTab} options={[{ value: "users", label: "Users", count: users.data?.users.length }, { value: "roles", label: "Roles & permissions", count: roleList.length }]} />

      {tab === "users" ? (
        <Card>
          <div className="mb-4 relative sm:w-72">
            <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-subtle" />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search users" className={cn(inputClass, "h-8 pl-9 text-xs")} />
          </div>
          {!users.data ? (
            <p className="text-sm text-muted">Loading…</p>
          ) : (
            <Table>
              <thead>
                <tr>
                  <th>User</th>
                  <th>Role</th>
                  <th>Status</th>
                  <th>Last active</th>
                  <th className="text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {list.map((u) => {
                  const self = u.id === me?.id;
                  const ownerLocked = (u.role_id === "owner" || self) && me?.role !== "owner";
                  return (
                    <tr key={u.id}>
                      <td>
                        <div className="flex items-center gap-3">
                          <Avatar name={u.name} size="sm" />
                          <div>
                            <p className="font-medium">
                              {u.name} {self && <span className="text-xs font-normal text-subtle">(you)</span>}
                            </p>
                            <p className="text-[11px] text-subtle">{u.email}</p>
                          </div>
                        </div>
                      </td>
                      <td>
                        <select
                          value={u.role_id}
                          disabled={self || ownerLocked}
                          onChange={(e) => patch(u, { roleId: e.target.value }, `${u.name} is now ${roleList.find((r) => r.id === e.target.value)?.name}`)}
                          aria-label={`Role for ${u.name}`}
                          className={cn(inputClass, "h-7 !w-36 text-xs")}
                        >
                          {roleList.map((r) => (
                            <option key={r.id} value={r.id} disabled={r.id === "owner" && me?.role !== "owner"}>
                              {r.name}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td>
                        <StatusBadge status={u.status} />
                        {u.status === "invited" && u.invite_expires_at && <p className="mt-0.5 text-[11px] text-subtle">{isPast(u.invite_expires_at) ? "link expired" : `link expires ${new Date(u.invite_expires_at).toLocaleDateString()}`}</p>}
                      </td>
                      <td className="text-muted">{u.last_active_at ? ago(u.last_active_at) : "—"}</td>
                      <td>
                        <div className="flex justify-end gap-1">
                          {u.status === "invited" && (
                            <Button size="sm" variant="ghost" icon={Link2} onClick={() => resend(u)}>
                              Invite link
                            </Button>
                          )}
                          {!self && !ownerLocked && u.status !== "invited" && (
                            <Button size="sm" variant="ghost" onClick={() => patch(u, { status: u.status === "suspended" ? "active" : "suspended" }, u.status === "suspended" ? `${u.name} reactivated` : `${u.name} suspended`)}>
                              {u.status === "suspended" ? "Reactivate" : "Suspend"}
                            </Button>
                          )}
                          {!self && !ownerLocked && <IconButton icon={Trash2} label={`Remove ${u.name}`} onClick={() => remove(u)} />}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </Table>
          )}
        </Card>
      ) : (
        <RolesTab roles={roleList} canEdit={can("roles.manage")} reload={roles.reload} />
      )}

      {inviting && (
        <InviteDialog
          roles={roleList.filter((r) => r.id !== "owner" || me?.role === "owner")}
          onClose={() => setInviting(false)}
          onInvited={(name, url) => {
            setInviting(false);
            setLink({ name, url });
            users.reload();
          }}
        />
      )}
      {link && <InviteLink {...link} onClose={() => setLink(null)} />}
    </div>
  );
}

function InviteDialog({ roles, onClose, onInvited }: { roles: Role[]; onClose: () => void; onInvited: (name: string, url: string) => void }) {
  const { toast } = useToast();
  const [f, setF] = useState({ name: "", email: "", roleId: "viewer" });
  const [busy, setBusy] = useState(false);
  return (
    <Modal title="Invite a user" onClose={onClose} icon={UserPlus}>
      <form
        className="space-y-4"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          try {
            const r = await api<{ inviteUrl: string }>("/api/users", { body: f });
            onInvited(f.name, r.inviteUrl);
          } catch (err) {
            toast({ title: "Couldn't invite", body: (err as Error).message, tone: "error" });
            setBusy(false);
          }
        }}
      >
        <Field label="Name">
          <input className={inputClass} required autoFocus value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
        </Field>
        <Field label="Email">
          <input className={inputClass} type="email" required value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} />
        </Field>
        <Field label="Role">
          <select className={inputClass} value={f.roleId} onChange={(e) => setF({ ...f, roleId: e.target.value })}>
            {roles.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name} — {r.description}
              </option>
            ))}
          </select>
        </Field>
        <p className="text-xs text-subtle">You&apos;ll get a sign-up link to send them. It&apos;s valid for 72 hours.</p>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" type="submit" disabled={busy}>
            Create invite
          </Button>
        </div>
      </form>
    </Modal>
  );
}

function InviteLink({ name, url, onClose }: { name: string; url: string; onClose: () => void }) {
  const { toast } = useToast();
  return (
    <Modal title={`Invite link for ${name}`} onClose={onClose} icon={Link2}>
      <p className="text-sm text-muted">Send this link to {name}. Anyone with it can create the account, so share it privately.</p>
      <div className="mt-4 flex items-center gap-2 rounded-lg border border-line bg-inset p-3">
        <code className="min-w-0 flex-1 truncate font-mono text-xs">{url}</code>
        <Button size="sm" variant="ghost" icon={Copy} onClick={() => navigator.clipboard?.writeText(url).then(() => toast({ title: "Copied", tone: "success" }))}>
          Copy
        </Button>
      </div>
      <div className="mt-6 flex justify-end">
        <Button variant="primary" onClick={onClose}>
          Done
        </Button>
      </div>
    </Modal>
  );
}

function RolesTab({ roles, canEdit, reload }: { roles: Role[]; canEdit: boolean; reload: () => void }) {
  const { toast } = useToast();
  const confirm = useConfirm();
  const [draft, setDraft] = useState<Record<string, Set<string>> | null>(null);
  const [creating, setCreating] = useState(false);
  const matrix = draft ?? Object.fromEntries(roles.map((r) => [r.id, new Set(r.permissions)]));
  const dirty = draft !== null;

  function flip(roleId: string, perm: string) {
    if (!canEdit || roleId === "owner") return;
    const base = draft ?? Object.fromEntries(roles.map((r) => [r.id, new Set(r.permissions)]));
    const next = { ...base, [roleId]: new Set(base[roleId]) };
    if (next[roleId].has(perm)) next[roleId].delete(perm);
    else next[roleId].add(perm);
    setDraft(next);
  }

  async function save() {
    try {
      for (const r of roles) {
        if (r.id === "owner") continue;
        const now = [...matrix[r.id]].sort();
        if (now.join() !== [...r.permissions].sort().join()) await api(`/api/roles/${r.id}`, { method: "PUT", body: { permissions: now } });
      }
      toast({ title: "Permissions saved", body: "Changes apply immediately to everyone in those roles.", tone: "success" });
      setDraft(null);
      reload();
    } catch (err) {
      toast({ title: "Couldn't save permissions", body: (err as Error).message, tone: "error" });
    }
  }

  async function removeRole(r: Role) {
    if (!(await confirm({ title: `Delete the ${r.name} role?`, confirmLabel: "Delete", danger: true }))) return;
    try {
      await api(`/api/roles/${r.id}`, { method: "DELETE" });
      reload();
    } catch (err) {
      toast({ title: "Couldn't delete role", body: (err as Error).message, tone: "error" });
    }
  }

  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {roles.map((r) => (
          <Card key={r.id} className="p-4">
            <div className="flex items-center justify-between">
              <Badge tone={roleTone(r.id)}>{r.name}</Badge>
              <span className="flex items-center gap-1">
                <span className="tabular text-xs text-subtle">
                  {r.members} member{r.members === 1 ? "" : "s"}
                </span>
                {canEdit && !r.builtin && <IconButton icon={Trash2} label={`Delete ${r.name}`} onClick={() => removeRole(r)} className="size-7" />}
              </span>
            </div>
            <p className="mt-3 text-sm text-muted">{r.description || "Custom role"}</p>
          </Card>
        ))}
        {canEdit && (
          <button onClick={() => setCreating(true)} className="flex min-h-28 flex-col items-center justify-center gap-2 rounded-2xl border border-dashed border-line-strong text-sm text-muted transition-colors hover:border-primary/50 hover:text-fg">
            <Plus className="size-4" />
            Create custom role
          </button>
        )}
      </div>

      <Card>
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <span className="grid size-8 place-items-center rounded-lg bg-primary-soft text-primary-fg">
              <KeyRound className="size-4" />
            </span>
            <div>
              <h2 className="text-sm font-semibold">Permission matrix</h2>
              <p className="text-xs text-subtle">{canEdit ? "Click a cell to grant or revoke. Owner permissions are fixed." : "Only owners can change permissions."}</p>
            </div>
          </div>
          {dirty && (
            <div className="flex gap-2">
              <Button size="sm" variant="ghost" onClick={() => setDraft(null)}>
                Discard
              </Button>
              <Button size="sm" variant="primary" onClick={save}>
                Save changes
              </Button>
            </div>
          )}
        </div>
        <Table>
          <thead>
            <tr>
              <th>Permission</th>
              {roles.map((r) => (
                <th key={r.id} className="w-28 !text-center">
                  {r.name}
                </th>
              ))}
            </tr>
          </thead>
          {PERMISSION_GROUPS.map((g) => (
            <tbody key={g.group}>
              <tr className="!border-t-0 hover:!bg-transparent">
                <td colSpan={roles.length + 1} className="!pt-5 !pb-1 text-[11px] font-semibold tracking-wide text-primary-fg uppercase">
                  {g.group}
                </td>
              </tr>
              {g.items.map((p) => (
                <tr key={p.key}>
                  <td>
                    <p className="text-sm">{p.label}</p>
                    <p className="font-mono text-[11px] text-subtle">{p.key}</p>
                  </td>
                  {roles.map((r) => {
                    const on = matrix[r.id]?.has(p.key);
                    return (
                      <td key={r.id} className="text-center">
                        <button
                          onClick={() => flip(r.id, p.key)}
                          disabled={!canEdit || r.id === "owner"}
                          aria-pressed={on}
                          aria-label={`${on ? "Revoke" : "Grant"} ${p.label} for ${r.name}`}
                          className={cn("mx-auto grid size-7 place-items-center rounded-md transition-colors disabled:cursor-not-allowed", on ? "bg-primary-soft text-primary-fg ring-1 ring-primary/30" : "text-subtle hover:bg-fg/5")}
                        >
                          {on ? <Check className="size-4" /> : <Minus className="size-3.5" />}
                        </button>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          ))}
        </Table>
      </Card>

      {creating && <CreateRole onClose={() => setCreating(false)} onCreated={reload} />}
    </div>
  );
}

function CreateRole({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const { toast } = useToast();
  const [f, setF] = useState({ name: "", description: "" });
  return (
    <Modal title="Create a custom role" onClose={onClose} icon={KeyRound}>
      <form
        className="space-y-4"
        onSubmit={async (e) => {
          e.preventDefault();
          try {
            await api("/api/roles", { body: { ...f, permissions: ["metrics.view", "logs.view"] } });
            toast({ title: `${f.name} created`, body: "It starts with read-only access; grant more in the matrix.", tone: "success" });
            onCreated();
            onClose();
          } catch (err) {
            toast({ title: "Couldn't create role", body: (err as Error).message, tone: "error" });
          }
        }}
      >
        <Field label="Name">
          <input className={inputClass} required autoFocus value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
        </Field>
        <Field label="Description">
          <input className={inputClass} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} />
        </Field>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" type="submit">
            Create
          </Button>
        </div>
      </form>
    </Modal>
  );
}
