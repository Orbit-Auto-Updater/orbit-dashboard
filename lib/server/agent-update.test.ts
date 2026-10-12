import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import type { AgentInfo } from "./agent-protocol";
import { authenticateAgent, enroll, ingestReport } from "./agent";
import { newId, sha256 } from "./crypto";
import { compareVersions } from "./dist";
import { createAgentUpdateJob, expireTargets, jobDetail } from "./jobs";
import { agentsOverview } from "./queries";
import { ENGINES, testDb } from "./testing";

const dist = fs.mkdtempSync(path.join(os.tmpdir(), "ld-dist-"));
fs.writeFileSync(path.join(dist, "linux-dash-agent-linux-amd64"), "new agent binary");
fs.writeFileSync(path.join(dist, "VERSION"), "0.3.0\n");
process.env.AGENT_DIST_DIR = dist;
const binarySha = crypto.createHash("sha256").update("new agent binary").digest("hex");

const info = (over: Partial<AgentInfo> = {}): AgentInfo => ({
  version: "0.2.0", report_interval_seconds: 10, actions: { agent_update: true, updates: true, reboot: false }, features: { docker: true },
  self_update: true, supervisor: "systemd", ...over,
});
const user = { id: "usr_t", name: "Tester" };

async function server(db: Awaited<ReturnType<typeof testDb>>, hostname: string, arch = "amd64") {
  const token = "tok_" + newId("t");
  await db.insertInto("enrollment_tokens").values({ id: newId("enr"), label: "t", token_hash: sha256(token), token_prefix: "x", environment: "production", created_by: null, created_at: Date.now(), expires_at: null, max_uses: null, uses: 0, revoked: 0, last_used_at: null }).execute();
  const host = { hostname, os_name: "Ubuntu", os_id: "ubuntu", os_version: "24.04", kernel: "6.8", arch, cpu_cores: 1, mem_total_bytes: 1e9 };
  const creds = await enroll(db, { token, host });
  const auth = () => authenticateAgent(db, new Request("http://x", { headers: { "x-agent-id": creds.agent_id, authorization: `Bearer ${creds.secret}` } }));
  const report = async (version: string, agent?: AgentInfo, results?: unknown[]) => ingestReport(db, await auth(), { agent_version: version, sent_at: "", host, agent, results: results as never });
  return { id: creds.agent_id, report };
}

for (const engine of ENGINES) {
  describe(`agent self-update jobs (${engine})`, () => {
    it("updates outdated agents and completes when the new version reports in", async () => {
      const db = await testDb(engine);
      const a = await server(db, "web-1");
      const legacy = await server(db, "old-1");
      const disabled = await server(db, "locked-1");
      await a.report("0.2.0", info());
      await legacy.report("0.1.0"); // no agent info: can't self-update
      await disabled.report("0.2.0", info({ actions: { agent_update: false } }));

      const overview = await agentsOverview(db);
      assert.equal(overview.release?.version, "0.3.0");
      assert.equal(overview.counts.outdated, 3);
      assert.equal(overview.counts.updatable, 1);
      assert.match(overview.agents.find((x) => x.name === "old-1")!.blocker!, /re-run the installer/);

      const { jobId, queued, skipped } = await createAgentUpdateJob(db, user, "outdated");
      assert.equal(queued, 1);
      assert.deepEqual(skipped.map((s) => s.server).sort(), ["locked-1", "old-1"]);

      // The agent receives the checksum of the exact file it will download.
      const delivered = await a.report("0.2.0", info());
      const cmd = delivered.response.commands!.find((c) => c.type === "agent.update")!;
      assert.deepEqual(cmd.args, { version: "0.3.0", path: "/downloads/linux-dash-agent-linux-amd64", sha256: binarySha });

      // "Installed; restarting" doesn't finish the job...
      await a.report("0.2.0", info(), [{ id: cmd.id, type: "agent.update", ok: true, output: "installed 0.3.0; restarting", started_at: "", finished_at: "" }]);
      let job = await jobDetail(db, jobId);
      assert.equal(job!.targets[0].status, "running");
      assert.equal(job!.targets[0].phase, "restarting");
      // ...the new version reporting in does.
      await a.report("0.3.0", info({ version: "0.3.0" }));
      job = await jobDetail(db, jobId);
      assert.equal(job!.status, "succeeded");
      assert.equal((await agentsOverview(db)).agents.find((x) => x.name === "web-1")!.versionStatus, "current");
      await assert.rejects(createAgentUpdateJob(db, user, [a.id]), /already up to date/);
      await db.destroy();
    });

    it("reports rollbacks and agents that never come back", async () => {
      const db = await testDb(engine);
      const a = await server(db, "web-1");
      const b = await server(db, "web-2");
      await a.report("0.2.0", info());
      await b.report("0.2.0", info());
      const { jobId } = await createAgentUpdateJob(db, user, "outdated");
      for (const s of [a, b]) {
        const r = await s.report("0.2.0", info());
        const cmd = r.response.commands!.find((c) => c.type === "agent.update")!;
        await s.report("0.2.0", info(), [{ id: cmd.id, type: "agent.update", ok: true, output: "installed", started_at: "", finished_at: "" }]);
      }
      // web-1 comes back on the old version and says it rolled back.
      await a.report("0.2.0", info({ last_update: { from: "0.2.0", to: "0.3.0", status: "rolled_back", detail: "the new version couldn't report to the dashboard", finished_at: "" } }));
      // web-2 never comes back.
      await expireTargets(db, Date.now() + 11 * 60_000);
      const job = await jobDetail(db, jobId);
      const byName = Object.fromEntries(job!.targets.map((t) => [t.server, t]));
      assert.equal(byName["web-1"].status, "failed");
      assert.match(byName["web-1"].error!, /Rolled back to 0.2.0/);
      assert.equal(byName["web-2"].status, "failed");
      assert.match(byName["web-2"].error!, /didn't report the new version/);
      assert.equal(job!.status, "failed");
      await db.destroy();
    });
  });
}

describe("version comparison", () => {
  it("orders semantic versions and flags others as incomparable", () => {
    assert.equal(compareVersions("0.2.0", "0.3.0"), -1);
    assert.equal(compareVersions("v1.10.0", "1.9.9"), 1);
    assert.equal(compareVersions("1.0.0", "1.0.0"), 0);
    assert.equal(compareVersions("dev", "0.3.0"), null);
  });
});
