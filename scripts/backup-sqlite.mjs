#!/usr/bin/env node
/**
 * Online backup of the SQLite database (safe while the dashboard is running).
 *
 *   docker compose exec dashboard node scripts/backup-sqlite.mjs
 *   → /data/backups/linux-dash-YYYYMMDD-HHMMSS.db
 *
 * PostgreSQL deployments should use pg_dump instead (see DEPLOY.md).
 */
import fs from "node:fs";
import path from "node:path";
import { backup, DatabaseSync } from "node:sqlite";

const dataDir = process.env.LINUX_DASH_DATA_DIR || path.join(process.cwd(), "data");
const url = process.env.DATABASE_URL || (process.env.DATABASE_URL_FILE ? fs.readFileSync(process.env.DATABASE_URL_FILE, "utf8").trim() : "");
let source = path.join(dataDir, "linux-dash.db");
if (url) {
  const m = /^(?:sqlite|file):(?:\/\/)?(.+)$/i.exec(url);
  if (!m) {
    console.error("DATABASE_URL is not a SQLite database; use pg_dump for PostgreSQL.");
    process.exit(1);
  }
  source = path.resolve(m[1]);
} else {
  try {
    const cfg = JSON.parse(fs.readFileSync(path.join(dataDir, "config.json"), "utf8"));
    if (cfg.database?.engine === "postgres") {
      console.error("This dashboard uses PostgreSQL; use pg_dump instead.");
      process.exit(1);
    }
    if (cfg.database?.path) source = cfg.database.path;
  } catch {}
}
if (!fs.existsSync(source)) {
  console.error(`No SQLite database at ${source}`);
  process.exit(1);
}

const stamp = new Date().toISOString().replace(/[-:]/g, "").replace("T", "-").slice(0, 15);
const dest = process.argv[2] ?? path.join(dataDir, "backups", `linux-dash-${stamp}.db`);
fs.mkdirSync(path.dirname(dest), { recursive: true, mode: 0o700 });

const db = new DatabaseSync(source, { readOnly: true });
await backup(db, dest);
db.close();
fs.chmodSync(dest, 0o600);
console.log(`Backed up ${source} → ${dest} (${(fs.statSync(dest).size / 1024).toFixed(0)} KiB)`);
