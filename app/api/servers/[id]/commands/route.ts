import { ApiError, notFound, readJson, route } from "@/lib/server/api";
import { queueCommand } from "@/lib/server/agent";
import { requireUser } from "@/lib/server/auth";
import { validateCommand } from "@/lib/server/commands";
import { getDb } from "@/lib/server/db";
import { audit } from "@/lib/server/settings";
import { commandPermission } from "@/lib/permissions";

type Ctx = { params: Promise<{ id: string }> };

export const GET = route<Ctx>(async (_req, { params }) => {
  await requireUser("metrics.view");
  const { id } = await params;
  const db = await getDb();
  const rows = await db.selectFrom("commands").selectAll().where("server_id", "=", id).orderBy("created_at", "desc").limit(50).execute();
  return { commands: rows.map((c) => ({ ...c, args: JSON.parse(c.args) })) };
});

export const POST = route<Ctx>(async (req, { params }) => {
  const b = await readJson(req);
  const cmd = validateCommand(b.type, b.args);
  const perm = commandPermission(cmd.type);
  if (!perm) throw new ApiError(400, "Unsupported command");
  const user = await requireUser(perm);
  const { id } = await params;
  const db = await getDb();
  const server = await db.selectFrom("servers").select(["id", "hostname"]).where("id", "=", id).executeTakeFirst();
  if (!server) throw notFound("Server not found");
  const commandId = await queueCommand(db, { serverId: id, type: cmd.type, args: cmd.args, label: cmd.label, user });
  await audit(db, user, `command.${cmd.type}`, server.hostname, cmd.label);
  return { id: commandId, label: cmd.label };
});
