import type { Kysely } from "kysely";
import { newId, randomToken, sha256 } from "./crypto";
import type { DB } from "./schema";
import { audit } from "./settings";

export async function createEnrollmentToken(
  db: Kysely<DB>,
  o: { label: string; environment: string; expiresInDays: number | null; maxUses: number | null; user: { id: string; name: string } },
) {
  const token = `ldt_${randomToken(24)}`;
  const now = Date.now();
  const id = newId("enr");
  await db
    .insertInto("enrollment_tokens")
    .values({
      id, label: o.label, token_hash: sha256(token), token_prefix: token.slice(0, 10), environment: o.environment, created_by: o.user.id, created_at: now,
      expires_at: o.expiresInDays ? now + o.expiresInDays * 86_400_000 : null, max_uses: o.maxUses, uses: 0, revoked: 0, last_used_at: null,
    })
    .execute();
  await audit(db, o.user, "enrollment_token.created", o.label, `environment ${o.environment}`);
  return { id, token };
}

export function installCommand(publicUrl: string, token: string) {
  return `curl -fsSL ${publicUrl}/install.sh | sudo sh -s -- --server ${publicUrl} --token ${token}`;
}
