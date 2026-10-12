import { enroll, readAgentBody } from "@/lib/server/agent";
import { route } from "@/lib/server/api";
import { getDb } from "@/lib/server/db";

export const POST = route(async (req) => enroll(await getDb(), await readAgentBody(req)));
