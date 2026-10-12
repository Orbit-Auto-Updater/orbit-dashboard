/**
 * Post-build safety net: the file tracer can copy files from the local runtime
 * data directory (config, SQLite database, setup code) into the standalone
 * bundle. They must never ship, so remove them after every build.
 */
import fs from "node:fs";
import path from "node:path";

const dir = path.join(".next", "standalone", "data");
if (fs.existsSync(dir)) {
  fs.rmSync(dir, { recursive: true, force: true });
  console.log("pruned .next/standalone/data (runtime data never ships with the build)");
}
