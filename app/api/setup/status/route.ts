import { checkSetupCode } from "@/lib/server/config";
import { route } from "@/lib/server/api";
import { defaultSqlitePath, setupState } from "@/lib/server/setup";

export const GET = route(async (req) => {
  const state = await setupState();
  const codeOk = state.step !== "done" && checkSetupCode(req.headers.get("x-setup-code"));
  return { ...state, codeOk, defaults: { sqlitePath: defaultSqlitePath() } };
});
