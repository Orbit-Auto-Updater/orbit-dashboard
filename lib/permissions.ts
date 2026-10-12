/** Permission keys enforced by the API and reflected in the UI. Shared by client and server. */
export const PERMISSION_GROUPS = [
  {
    group: "Monitoring",
    items: [
      { key: "metrics.view", label: "View servers & metrics" },
      { key: "logs.view", label: "View logs & alerts" },
      { key: "alerts.ack", label: "Acknowledge alerts & vulnerabilities" },
    ],
  },
  {
    group: "Operations",
    items: [
      { key: "apps.control", label: "Start / stop / restart apps" },
      { key: "updates.run", label: "Run update checks & installs" },
      { key: "updates.policy", label: "Edit auto-update policies" },
      { key: "servers.reboot", label: "Reboot servers" },
      { key: "servers.manage", label: "Enrol, edit & remove servers" },
    ],
  },
  {
    group: "Administration",
    items: [
      { key: "users.manage", label: "Invite & manage users" },
      { key: "roles.manage", label: "Edit roles & permissions" },
      { key: "org.settings", label: "Organisation settings" },
    ],
  },
] as const;

export type Permission = (typeof PERMISSION_GROUPS)[number]["items"][number]["key"];

export const PERMISSION_LIST: { key: Permission; label: string; group: string }[] = PERMISSION_GROUPS.flatMap((g) =>
  g.items.map((i) => ({ key: i.key as Permission, label: i.label as string, group: g.group as string })),
);

export const ALL_PERMISSIONS: Permission[] = PERMISSION_LIST.map((p) => p.key);

export function isPermission(v: string): v is Permission {
  return (ALL_PERMISSIONS as string[]).includes(v);
}

/** Built-in roles and their default grants. The owner role always has everything. */
export const BUILTIN_ROLES: { id: string; name: string; description: string; permissions: Permission[] }[] = [
  { id: "owner", name: "Owner", description: "Full access, including roles and organisation settings.", permissions: ALL_PERMISSIONS },
  {
    id: "admin",
    name: "Admin",
    description: "Manage servers, policies, users and integrations.",
    permissions: ALL_PERMISSIONS.filter((p) => p !== "roles.manage" && p !== "org.settings"),
  },
  {
    id: "operator",
    name: "Operator",
    description: "Run updates, restart apps and acknowledge alerts.",
    permissions: ["metrics.view", "logs.view", "alerts.ack", "apps.control", "updates.run"],
  },
  { id: "viewer", name: "Viewer", description: "Read-only access to dashboards and logs.", permissions: ["metrics.view", "logs.view"] },
];

/** Permission required to send each agent command type. */
export function commandPermission(type: string): Permission | null {
  if (type === "agent.refresh") return "metrics.view";
  if (type === "updates.check" || type === "updates.apply") return "updates.run";
  if (type === "host.reboot") return "servers.reboot";
  if (/^(docker|pm2|systemd)\.(start|stop|restart)$/.test(type)) return "apps.control";
  return null;
}
