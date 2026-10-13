/**
 * Instance configuration stored on disk (the database connection and whether
 * first-time setup has finished). Everything else lives in the database.
 *
 * DATABASE_URL, when set, overrides the stored database connection:
 *   postgres://user:pass@host:5432/db   or   sqlite:/var/lib/orbit/orbit.db
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

export type DbConfig =
  | { engine: "sqlite"; path: string }
  | { engine: "postgres"; url: string; ssl?: "disable" | "require" | "verify-full" };

export type AppConfig = {
  database?: DbConfig;
  setupComplete?: boolean;
};

export function dataDir() {
  // turbopackIgnore: this is a runtime location, not a build input; without it
  // the file tracer copies the whole project (including data/) into the bundle.
  return path.resolve(/*turbopackIgnore: true*/ process.env.ORBIT_DATA_DIR || path.join(process.cwd(), "data"));
}

const configFile = () => path.join(/*turbopackIgnore: true*/ dataDir(), "config.json");

let cache: { mtimeMs: number; value: AppConfig } | null = null;

export function readConfig(): AppConfig {
  try {
    const st = fs.statSync(/*turbopackIgnore: true*/ configFile());
    if (cache && cache.mtimeMs === st.mtimeMs) return cache.value;
    const value = JSON.parse(fs.readFileSync(/*turbopackIgnore: true*/ configFile(), "utf8")) as AppConfig;
    cache = { mtimeMs: st.mtimeMs, value };
    return value;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return {};
    throw err;
  }
}

export function writeConfig(patch: Partial<AppConfig>) {
  const next = { ...readConfig(), ...patch };
  fs.mkdirSync(/*turbopackIgnore: true*/ dataDir(), { recursive: true, mode: 0o700 });
  const tmp = configFile() + ".tmp";
  fs.writeFileSync(/*turbopackIgnore: true*/ tmp, JSON.stringify(next, null, 2), { mode: 0o600 });
  fs.renameSync(/*turbopackIgnore: true*/ tmp, configFile());
  cache = null;
}

export function parseDatabaseUrl(url: string): DbConfig | null {
  const u = url.trim();
  if (/^postgres(ql)?:\/\//i.test(u)) {
    const ssl = /[?&]sslmode=(require|verify-full)/i.exec(u)?.[1]?.toLowerCase() as "require" | "verify-full" | undefined;
    return { engine: "postgres", url: u, ssl: ssl ?? "disable" };
  }
  const m = /^(?:sqlite|file):(?:\/\/)?(.+)$/i.exec(u);
  if (m) return { engine: "sqlite", path: path.resolve(m[1]) };
  return null;
}

let fileUrl: { path: string; url: string } | null = null;

/**
 * DATABASE_URL, or DATABASE_URL_FILE pointing at a file that contains it
 * (e.g. a Docker secret), so the password needn't sit in the environment.
 */
export function envDatabase(): DbConfig | null {
  let url = process.env.DATABASE_URL;
  const file = process.env.DATABASE_URL_FILE;
  if (!url && file) {
    if (fileUrl?.path !== file) fileUrl = { path: file, url: fs.readFileSync(/*turbopackIgnore: true*/ file, "utf8").trim() };
    url = fileUrl.url;
  }
  return url ? parseDatabaseUrl(url) : null;
}

export function getDbConfig(): DbConfig | null {
  return envDatabase() ?? readConfig().database ?? null;
}

export function isSetupComplete(): boolean {
  return readConfig().setupComplete === true && getDbConfig() !== null;
}

/**
 * One-time code that must be entered in the setup wizard, so a freshly
 * deployed dashboard can't be claimed by whoever reaches it first. It is
 * printed to the server log and stored in the data directory.
 */
export function getSetupCode(): string {
  const file = path.join(/*turbopackIgnore: true*/ dataDir(), "setup-code");
  try {
    return fs.readFileSync(/*turbopackIgnore: true*/ file, "utf8").trim();
  } catch {
    const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    const bytes = crypto.randomBytes(8);
    const raw = Array.from(bytes, (b) => alphabet[b % alphabet.length]).join("");
    const code = `${raw.slice(0, 4)}-${raw.slice(4)}`;
    fs.mkdirSync(/*turbopackIgnore: true*/ dataDir(), { recursive: true, mode: 0o700 });
    fs.writeFileSync(/*turbopackIgnore: true*/ file, code + "\n", { mode: 0o600 });
    return code;
  }
}

export function checkSetupCode(given: string | null | undefined): boolean {
  if (!given) return false;
  const a = Buffer.from(given.trim().toUpperCase());
  const b = Buffer.from(getSetupCode());
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export function clearSetupCode() {
  fs.rmSync(/*turbopackIgnore: true*/ path.join(dataDir(), "setup-code"), { force: true });
}
