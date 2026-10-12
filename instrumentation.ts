export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs" || process.env.NEXT_PHASE === "phase-production-build") return;
  const { isSetupComplete, getSetupCode } = await import("./lib/server/config");
  if (!isSetupComplete()) {
    const { dataDir } = await import("./lib/server/config");
    console.log(`\n  ▶ First-time setup: open the dashboard and enter setup code ${getSetupCode()}\n    (also in ${dataDir()}/setup-code)\n`);
  }
  const { startScheduler } = await import("./lib/server/scheduler");
  startScheduler();
}
