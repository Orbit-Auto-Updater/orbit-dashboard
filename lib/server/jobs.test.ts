import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { authenticateAgent, enroll, ingestReport } from "./agent";
import { newId, sha256 } from "./crypto";
import { createUpdateJob, expireTargets, ingestProgress, jobDetail, jobLogs, jobsList, jobStatus } from "./jobs";
import { ENGINES, testDb } from "./testing";

const host = { hostname: "web-1", os_name: "Ubuntu 24.04 LTS", os_id: "ubuntu", os_version: "24.04", kernel: "6.8", arch: "amd64", cpu_cores: 2, mem_total_bytes: 1e9, package_manager: "apt" };
const user = { id: "usr_test", name: "Tester" };

async function setup(engine: (typeof ENGINES)[number]) {
  const db = await testDb(engine);
  const token = "tok_" + newId("t");
  await db.insertInto("enrollment_tokens").values({ id: newId("enr"), label: "t", token_hash: sha256(token), token_prefix: "x", environment: "production", created_by: null, created_at: Date.now(), expires_at: null, max_uses: null, uses: 0, revoked: 0, last_used_at: null }).execute();
  const { agent_id, secret } = await enroll(db, { token, host });
  const auth = () => authenticateAgent(db, new Request("http://x", { headers: { "x-agent-id": agent_id, authorization: `Bearer ${secret}` } }));
  const updates = { manager: "apt", checked_at: "", reboot_required: false, running: false, packages: [{ name: "openssl", current: "1", available: "2", security: true }, { name: "curl", current: "1", available: "2", security: true }] };
  await ingestReport(db, await auth(), { agent_version: "x", sent_at: "", host, updates });
  return { db, serverId: agent_id, auth };
}

const line = (text: string, s = "stdout") => ({ t: new Date().toISOString(), s, text });

for (const engine of ENGINES) {
  describe(`update jobs (${engine})`, () => {
    it("streams output and installed packages into a job, idempotently", async () => {
      const { db, serverId, auth } = await setup(engine);
      const { jobId, commands } = await createUpdateJob(db, user, { serverIds: [serverId], securityOnly: true });
      let job = await jobDetail(db, jobId);
      assert.equal(job?.status, "queued");
      assert.equal(job?.label, "Install security updates");

      const server = await auth();
      const base = { run_id: "run_0123456789abcdef", command_id: commands[0].commandId, kind: "updates.apply", trigger: "command", started_at: new Date().toISOString() };
      await ingestProgress(db, server, { ...base, phase: "installing", total: 2, seq: 0, lines: [line("Pre-flight checks", "agent"), line("Unpacking openssl (2) over (1) ...")] });
      await ingestProgress(db, server, { ...base, phase: "installing", total: 2, seq: 2, lines: [line("Setting up openssl (2) ...")], installed: [{ name: "openssl", version: "2", t: new Date().toISOString() }] });
      // A retried chunk must not duplicate anything.
      await ingestProgress(db, server, { ...base, phase: "installing", total: 2, seq: 2, lines: [line("Setting up openssl (2) ...")], installed: [{ name: "openssl", version: "2", t: new Date().toISOString() }] });

      job = await jobDetail(db, jobId);
      const t = job!.targets[0];
      assert.equal(job!.status, "running");
      assert.equal(t.phase, "installing");
      assert.equal(t.done, 1);
      assert.equal(t.total, 2);
      assert.equal(t.logLines, 3);

      const tail = await jobLogs(db, jobId, t.id, 0);
      assert.deepEqual(tail?.lines.map((l) => l.seq), [1, 2], "only lines after seq 0");

      await ingestProgress(db, server, { ...base, phase: "done", seq: 3, lines: [line("Setting up curl (2) ...")], installed: [{ name: "curl", version: "2", t: new Date().toISOString() }], done: true, status: "success" });
      job = await jobDetail(db, jobId);
      assert.equal(job!.status, "succeeded");
      assert.deepEqual(job!.targets[0].installed.map((p) => p.name), ["openssl", "curl"]);
      assert.equal(job!.packages.installed, 2);

      // The later command result doesn't override the streamed outcome.
      await ingestReport(db, server, { agent_version: "x", sent_at: "", host, results: [{ id: commands[0].commandId, type: "updates.apply", ok: true, output: "upgraded 2", started_at: "", finished_at: "" }] });
      assert.equal((await jobLogs(db, jobId, t.id, -1))?.lines.length, 4);
      await db.destroy();
    });

    it("creates a job for scheduled runs and falls back to the command output for older agents", async () => {
      const { db, serverId, auth } = await setup(engine);
      await ingestProgress(db, await auth(), { run_id: "run_schedule000001", kind: "updates.apply", trigger: "schedule", started_at: new Date().toISOString(), seq: 0, lines: [line("Refreshing apt package lists", "agent")], phase: "refreshing" });
      const [scheduled] = await jobsList(db);
      assert.equal(scheduled.trigger, "schedule");
      assert.equal(scheduled.label, "Scheduled updates (Production)");
      assert.equal(scheduled.status, "running");

      // An agent without streaming: only the final command result arrives.
      const { jobId, commands } = await createUpdateJob(db, user, { serverIds: "all", packages: ["curl"] });
      await ingestReport(db, await auth(), { agent_version: "x", sent_at: "", host, results: [{ id: commands[0].commandId, type: "updates.apply", ok: false, output: "Reading package lists...\nE: dpkg was interrupted", error: "apt-get exited 100", started_at: "", finished_at: "" }] });
      const job = await jobDetail(db, jobId);
      assert.equal(job!.status, "failed");
      assert.equal(job!.targets[0].error, "apt-get exited 100");
      const logs = await jobLogs(db, jobId, job!.targets[0].id, -1);
      assert.deepEqual(logs?.lines.map((l) => l.text), ["Reading package lists...", "E: dpkg was interrupted", "apt-get exited 100"]);
      assert.equal(serverId.startsWith("srv_"), true);
      await db.destroy();
    });

    it("expires jobs the agent never picked up and rejects packages nobody has pending", async () => {
      const { db, serverId } = await setup(engine);
      const { jobId, commands } = await createUpdateJob(db, user, { serverIds: [serverId] });
      await db.updateTable("commands").set({ status: "expired" }).where("id", "=", commands[0].commandId).execute();
      await expireTargets(db);
      assert.equal((await jobDetail(db, jobId))!.status, "failed");
      assert.equal((await jobDetail(db, jobId))!.targets[0].status, "expired");
      await assert.rejects(createUpdateJob(db, user, { serverIds: "all", packages: ["not-pending"] }), /None of the selected servers/);
      await db.destroy();
    });
  });
}

describe("job status", () => {
  it("summarises target states", () => {
    assert.equal(jobStatus(["queued", "queued"]), "queued");
    assert.equal(jobStatus(["succeeded", "queued"]), "running");
    assert.equal(jobStatus(["succeeded", "succeeded"]), "succeeded");
    assert.equal(jobStatus(["succeeded", "failed"]), "partial");
    assert.equal(jobStatus(["expired", "failed"]), "failed");
  });
});
