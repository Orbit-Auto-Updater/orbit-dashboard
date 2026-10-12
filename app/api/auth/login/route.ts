import { ApiError, clientIp, readJson, route, str } from "@/lib/server/api";
import { createSession, loginThrottle } from "@/lib/server/auth";
import { timingDummy, verifyPassword } from "@/lib/server/crypto";
import { getDb } from "@/lib/server/db";
import { audit } from "@/lib/server/settings";

export const POST = route(async (req) => {
  const body = await readJson(req);
  const email = str(body.email, "email", { max: 254 }).toLowerCase();
  const password = str(body.password, "password", { max: 500 });
  const throttle = loginThrottle(`${clientIp(req) ?? "?"}|${email}`);
  const db = await getDb();
  const user = await db.selectFrom("users").select(["id", "name", "password_hash", "status"]).where("email", "=", email).executeTakeFirst();
  const ok = user ? await verifyPassword(password, user.password_hash) : (await verifyPassword(password, await timingDummy()), false);
  if (!user || !ok) {
    throttle.fail();
    throw new ApiError(401, "Incorrect email or password");
  }
  if (user.status !== "active") throw new ApiError(403, user.status === "suspended" ? "This account is suspended" : "Finish setting up this account from your invite link");
  throttle.success();
  await createSession(db, user.id, req);
  await audit(db, user, "user.login", user.name);
  return { ok: true };
});
