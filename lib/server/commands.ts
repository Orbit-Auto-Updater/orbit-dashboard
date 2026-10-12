/** Validation of dashboard-issued agent commands. */
import type { Kysely } from "kysely";
import { COMMAND_TYPES, type CommandType } from "./agent-protocol";
import { badRequest, int } from "./api";
import { newId } from "./crypto";
import type { DB } from "./schema";

const NAME = /^[A-Za-z0-9][A-Za-z0-9_.@:-]{0,254}$/;
const USER = /^[a-z_][a-z0-9_-]{0,31}$/;
const PKG = /^[A-Za-z0-9][A-Za-z0-9+._:@~-]{0,254}$/;

/** Validate args for a command type and produce a human label. */
export function validateCommand(type: unknown, raw: unknown): { type: CommandType; args: Record<string, unknown>; label: string } {
  if (typeof type !== "string" || !(COMMAND_TYPES as readonly string[]).includes(type)) throw badRequest(`Unknown command type ${String(type)}`);
  const t = type as CommandType;
  const a = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const [kind, action] = t.split(".");
  const verb = action ? action[0].toUpperCase() + action.slice(1) : "";
  switch (kind) {
    case "docker": {
      if (typeof a.id !== "string" || !NAME.test(a.id)) throw badRequest("A valid container id or name is required");
      return { type: t, args: { id: a.id }, label: `${verb} container ${a.id}` };
    }
    case "pm2": {
      if (typeof a.name !== "string" || !NAME.test(a.name)) throw badRequest("A valid PM2 app name is required");
      if (a.user !== undefined && a.user !== "" && (typeof a.user !== "string" || !USER.test(a.user))) throw badRequest("Invalid PM2 user");
      return { type: t, args: a.user ? { name: a.name, user: a.user } : { name: a.name }, label: `${verb} PM2 app ${a.name}` };
    }
    case "systemd": {
      if (typeof a.unit !== "string" || !NAME.test(a.unit)) throw badRequest("A valid unit name is required");
      return { type: t, args: { unit: a.unit }, label: `${verb} ${a.unit}` };
    }
    case "host": {
      const delay = a.delay_minutes === undefined ? 1 : int(a.delay_minutes, "delay_minutes", 1, 60);
      return { type: t, args: { delay_minutes: delay }, label: `Reboot in ${delay} min` };
    }
    case "updates": {
      if (action === "check") return { type: t, args: {}, label: "Check for updates" };
      const packages = a.packages === undefined ? [] : a.packages;
      if (!Array.isArray(packages) || packages.length > 2000 || packages.some((p) => typeof p !== "string" || !PKG.test(p))) throw badRequest("Invalid package list");
      const securityOnly = a.security_only === true;
      const args: Record<string, unknown> = {};
      if (packages.length) args.packages = packages;
      if (securityOnly) args.security_only = true;
      const label = packages.length ? `Install ${packages.length === 1 ? packages[0] : `${packages.length} packages`}` : securityOnly ? "Install security updates" : "Install all updates";
      return { type: t, args, label };
    }
    case "agent": {
      if (action === "refresh") return { type: t, args: {}, label: "Refresh data" };
      if (typeof a.version !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._+-]{0,63}$/.test(a.version)) throw badRequest("Invalid agent version");
      if (typeof a.sha256 !== "string" || !/^[a-f0-9]{64}$/.test(a.sha256)) throw badRequest("Invalid checksum");
      if (typeof a.path !== "string" || !/^\/downloads\/linux-dash-agent-linux-(amd64|arm64|arm|386)$/.test(a.path)) throw badRequest("Invalid download path");
      return { type: t, args: { version: a.version, path: a.path, sha256: a.sha256 }, label: `Update agent to ${a.version}` };
    }
  }
  throw badRequest("Unsupported command");
}


export async function queueCommand(
  db: Kysely<DB>,
  opts: { serverId: string; type: string; args: unknown; label: string; user: { id: string; name: string } | null; ttlMinutes?: number },
) {
  const now = Date.now();
  const id = newId("cmd");
  await db
    .insertInto("commands")
    .values({
      id, server_id: opts.serverId, type: opts.type, args: JSON.stringify(opts.args ?? {}), status: "pending", label: opts.label.slice(0, 200),
      created_by: opts.user?.id ?? null, created_by_name: opts.user?.name ?? "System", created_at: now,
      expires_at: now + (opts.ttlMinutes ?? 15) * 60_000, delivered_at: null, finished_at: null, output: null, error: null,
    })
    .execute();
  return id;
}
