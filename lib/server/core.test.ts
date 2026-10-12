/**
 * Backend tests, run against both SQLite and PostgreSQL (PGlite):
 *   pnpm test
 */
import assert from "node:assert/strict";
import zlib from "node:zlib";
import { describe, it } from "node:test";
import type { Report } from "./agent-protocol";
import { authenticateAgent, enroll, ingestReport, queueCommand, readAgentBody } from "./agent";
import { checkOffline } from "./alerts";
import { hashPassword, newId, sha256, verifyPassword } from "./crypto";
import { cvss3Score, osvEcosystem, osvFixedVersion, osvSeverity, primaryId, scanServer } from "./cve";
import { ENGINES, testDb } from "./testing";

async function withToken(db: Awaited<ReturnType<typeof testDb>>, opts: { maxUses?: number | null; environment?: string } = {}) {
  const token = "tok_" + newId("t");
  await db
    .insertInto("enrollment_tokens")
    .values({
      id: newId("enr"), label: "test", token_hash: sha256(token), token_prefix: token.slice(0, 8), environment: opts.environment ?? "staging",
      created_by: null, created_at: Date.now(), expires_at: null, max_uses: opts.maxUses ?? null, uses: 0, revoked: 0, last_used_at: null,
    })
    .execute();
  return token;
}

const host = { hostname: "web-1", os_name: "Ubuntu 24.04.1 LTS", os_id: "ubuntu", os_version: "24.04", kernel: "6.8.0", arch: "amd64", cpu_cores: 4, mem_total_bytes: 8e9, package_manager: "apt", ips: ["10.0.0.5"] };

function report(over: Partial<Report> = {}): Report {
  return {
    agent_version: "0.1.0",
    sent_at: new Date().toISOString(),
    host,
    metrics: {
      collected_at: new Date().toISOString(), cpu_percent: 20, cpu_iowait_percent: 1, load1: 0.5, load5: 0.4, load15: 0.3,
      mem_total_bytes: 8e9, mem_used_bytes: 4e9, mem_available_bytes: 4e9, mem_percent: 50, swap_total_bytes: 0, swap_used_bytes: 0, uptime_seconds: 1000,
      disks: [{ mount: "/", device: "/dev/sda1", fs_type: "ext4", total_bytes: 100e9, used_bytes: 95e9, free_bytes: 5e9, used_percent: 95, inodes_used_percent: 10 }],
      net: [{ name: "eth0", rx_bytes_per_sec: 1000, tx_bytes_per_sec: 500, rx_bytes_total: 1, tx_bytes_total: 1, rx_errors: 0, tx_errors: 0 }],
    },
    ...over,
  };
}

const fakeReq = (headers: Record<string, string>) => new Request("http://x/api/agent/v1/report", { method: "POST", headers });

for (const engine of ENGINES) {
  describe(`agent protocol (${engine})`, () => {
    it("enrols with a token, authenticates and rejects bad credentials", async () => {
      const db = await testDb(engine);
      const token = await withToken(db, { maxUses: 1, environment: "production" });
      const { agent_id, secret } = await enroll(db, { token, agent_version: "0.1.0", host });
      const server = await authenticateAgent(db, fakeReq({ "x-agent-id": agent_id, authorization: `Bearer ${secret}` }));
      assert.equal(server.hostname, "web-1");
      assert.equal(server.environment, "production");
      await assert.rejects(authenticateAgent(db, fakeReq({ "x-agent-id": agent_id, authorization: "Bearer wrong" })), /bad secret/);
      await assert.rejects(enroll(db, { token, host }), /used-up/, "single-use token must not enrol twice");
      await assert.rejects(enroll(db, { token: "nope", host }), /Invalid/);
      await db.destroy();
    });

    it("ingests reports, delivers commands until a result arrives, and raises/resolves alerts", async () => {
      const db = await testDb(engine);
      const { agent_id, secret } = await enroll(db, { token: await withToken(db), host });
      const auth = () => authenticateAgent(db, fakeReq({ "x-agent-id": agent_id, authorization: `Bearer ${secret}` }));

      const cmdId = await queueCommand(db, { serverId: agent_id, type: "docker.restart", args: { id: "api" }, label: "Restart api", user: null });
      const updates = {
        manager: "apt", checked_at: new Date().toISOString(), packages: [{ name: "libssl3t64", source: "openssl", current: "3.0.13-0ubuntu3.3", available: "3.0.13-0ubuntu3.4", security: true }],
        reboot_required: true, running: false,
        last_run: { trigger: "schedule", started_at: "2026-10-11T02:00:00Z", finished_at: "2026-10-11T02:04:00Z", status: "failed", error: "dpkg lock held" },
      };
      const apps = { collected_at: new Date().toISOString(), docker: { containers: [{ id: "a", name: "api", image: "x", state: "restarting", status: "Restarting", created_at: "", restart_count: 9, exit_code: 137, oom_killed: true, cpu_percent: 0, mem_bytes: 0, mem_limit_bytes: 0 }] } };
      const first = await ingestReport(db, await auth(), report({ updates, apps, logs: [{ time: new Date().toISOString(), priority: 3, unit: "nginx.service", message: "boom" }] }));
      assert.equal(first.packagesChanged, true);
      assert.deepEqual(first.response.commands?.map((c) => c.id), [cmdId]);
      assert.equal(first.response.policy?.scope, "security");

      // Re-delivered until the agent reports a result.
      const second = await ingestReport(db, await auth(), report());
      assert.deepEqual(second.response.commands?.map((c) => c.id), [cmdId]);
      assert.equal(second.packagesChanged, false);

      await ingestReport(db, await auth(), report({ results: [{ id: cmdId, type: "docker.restart", ok: true, output: "ok", started_at: new Date().toISOString(), finished_at: new Date().toISOString() }] }));
      const cmd = await db.selectFrom("commands").selectAll().where("id", "=", cmdId).executeTakeFirstOrThrow();
      assert.equal(cmd.status, "succeeded");

      const open = await db.selectFrom("alerts").select(["fingerprint", "severity"]).where("status", "=", "open").orderBy("fingerprint").execute();
      const fps = open.map((a) => a.fingerprint.split(":")[0]);
      assert.deepEqual(fps.sort(), ["container", "disk", "reboot", "update"].sort(), `got ${JSON.stringify(open)}`);

      // Conditions clearing resolve their alerts.
      const healthy = report({
        metrics: { ...report().metrics!, disks: [{ ...report().metrics!.disks![0], used_percent: 40 }] },
        apps: { collected_at: "", docker: { containers: [{ ...apps.docker.containers[0], state: "running" }] } },
      });
      await ingestReport(db, await auth(), healthy);
      const stillOpen = await db.selectFrom("alerts").select("fingerprint").where("status", "=", "open").execute();
      assert.ok(!stillOpen.some((a) => a.fingerprint.startsWith("disk:") || a.fingerprint.startsWith("container:")), JSON.stringify(stillOpen));

      assert.equal((await db.selectFrom("metrics").select("server_id").execute()).length, 4);
      assert.equal((await db.selectFrom("logs").select("id").execute()).length, 1);
      assert.equal((await db.selectFrom("update_runs").select("id").execute()).length, 1, "update run recorded once");

      // Offline detection.
      await checkOffline(db, Date.now() + 10 * 60_000);
      assert.ok(await db.selectFrom("alerts").select("id").where("fingerprint", "=", `offline:${agent_id}`).where("status", "=", "open").executeTakeFirst());
      await ingestReport(db, await auth(), report());
      assert.equal(await db.selectFrom("alerts").select("id").where("fingerprint", "=", `offline:${agent_id}`).where("status", "=", "open").executeTakeFirst(), undefined);
      await db.destroy();
    });

    it("scans pending packages against OSV and alerts on serious CVEs", async () => {
      const db = await testDb(engine);
      const { agent_id, secret } = await enroll(db, { token: await withToken(db), host });
      const server = await authenticateAgent(db, fakeReq({ "x-agent-id": agent_id, authorization: `Bearer ${secret}` }));
      await ingestReport(db, server, report({
        updates: {
          manager: "apt", checked_at: "", reboot_required: false, running: false,
          packages: [
            { name: "libssl3t64", source: "openssl", current: "3.0.13-0ubuntu3.3", available: "3.0.13-0ubuntu3.4", security: true },
            { name: "openssl", source: "openssl", current: "3.0.13-0ubuntu3.3", available: "3.0.13-0ubuntu3.4", security: true },
            { name: "tzdata", current: "2024a", available: "2024b", security: false },
            { name: "zlib1g", source: "zlib", current: "1:1.3", available: "1:1.3.1", security: true },
          ],
        },
      }));

      const calls: string[] = [];
      const fakeFetch = (async (url: string, init?: RequestInit) => {
        calls.push(url);
        if (url.endsWith("/querybatch")) {
          const body = JSON.parse(String(init?.body));
          assert.equal(body.queries[0].package.ecosystem, "Ubuntu:24.04:LTS");
          assert.deepEqual(body.queries.map((q: { package: { name: string } }) => q.package.name), ["openssl", "tzdata", "zlib"]);
          return Response.json({ results: [{ vulns: [{ id: "UBUNTU-CVE-2024-6119" }] }, {}, {}] });
        }
        return Response.json({
          id: "UBUNTU-CVE-2024-6119", aliases: ["CVE-2024-6119"], summary: "openssl: denial of service",
          severity: [{ type: "CVSS_V3", score: "CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H" }],
          affected: [{ package: { name: "openssl", ecosystem: "Ubuntu:24.04:LTS" }, ranges: [{ type: "ECOSYSTEM", events: [{ introduced: "0" }, { fixed: "3.0.13-0ubuntu3.4" }] }] }],
        });
      }) as typeof fetch;

      const result = await scanServer(db, agent_id, fakeFetch);
      assert.equal(result?.findings, 2, "one OSV finding + one distro-flagged package");
      const vulns = await db.selectFrom("vulnerabilities").selectAll().orderBy("package").execute();
      assert.equal(vulns[0].vuln_id, "CVE-2024-6119");
      assert.equal(vulns[0].binaries, "libssl3t64, openssl");
      assert.equal(vulns[0].severity, "critical");
      assert.equal(vulns[0].score, 9.8);
      assert.equal(vulns[0].fixed_version, "3.0.13-0ubuntu3.4");
      assert.equal(vulns[1].origin, "package-manager");
      const alert = await db.selectFrom("alerts").selectAll().where("fingerprint", "=", `cve:${agent_id}`).executeTakeFirstOrThrow();
      assert.equal(alert.severity, "critical");

      // Cached details: a rescan doesn't refetch the advisory.
      calls.length = 0;
      await scanServer(db, agent_id, fakeFetch);
      assert.equal(calls.filter((c) => c.includes("/vulns/")).length, 0);

      // Once updated, findings are marked fixed and the alert resolves.
      await ingestReport(db, server, report({ updates: { manager: "apt", checked_at: "", reboot_required: false, running: false, packages: [] } }));
      await scanServer(db, agent_id, fakeFetch);
      const after = await db.selectFrom("vulnerabilities").select("status").execute();
      assert.ok(after.every((v) => v.status === "fixed"));
      const resolved = await db.selectFrom("alerts").select("status").where("fingerprint", "=", `cve:${agent_id}`).executeTakeFirstOrThrow();
      assert.equal(resolved.status, "resolved");
      await db.destroy();
    });
  });
}

describe("helpers", () => {
  it("hashes and verifies passwords", async () => {
    const h = await hashPassword("correct horse battery");
    assert.ok(await verifyPassword("correct horse battery", h));
    assert.ok(!(await verifyPassword("wrong", h)));
    assert.ok(!(await verifyPassword("x", null)));
  });

  it("computes CVSS v3 base scores", () => {
    assert.equal(cvss3Score("CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H"), 9.8);
    assert.equal(cvss3Score("CVSS:3.1/AV:N/AC:L/PR:N/UI:R/S:C/C:L/I:L/A:N"), 6.1);
    assert.equal(cvss3Score("CVSS:3.0/AV:L/AC:L/PR:L/UI:N/S:U/C:H/I:N/A:N"), 5.5);
    assert.equal(cvss3Score("CVSS:3.1/AV:N/AC:H/PR:N/UI:N/S:U/C:N/I:N/A:H"), 5.9);
    assert.equal(cvss3Score("garbage"), null);
  });

  it("maps distributions to OSV ecosystems", () => {
    assert.equal(osvEcosystem("ubuntu", "24.04"), "Ubuntu:24.04:LTS");
    assert.equal(osvEcosystem("ubuntu", "24.10"), "Ubuntu:24.10");
    assert.equal(osvEcosystem("ubuntu", "23.04"), "Ubuntu:23.04");
    assert.equal(osvEcosystem("debian", "12"), "Debian:12");
    assert.equal(osvEcosystem("alpine", "3.20.3"), "Alpine:v3.20");
    assert.equal(osvEcosystem("rocky", "9.4"), "Rocky Linux:9");
    assert.equal(osvEcosystem("almalinux", "8.10"), "AlmaLinux:8");
    assert.equal(osvEcosystem("arch", ""), null);
  });

  it("reads severities and fixed versions from OSV records", () => {
    const debian = { id: "DSA-5764-1", aliases: ["CVE-2024-1"], affected: [{ package: { name: "openssl", ecosystem: "Debian:12" }, ecosystem_specific: { urgency: "high" }, ranges: [{ type: "ECOSYSTEM", events: [{ introduced: "0" }, { fixed: "3.0.14-1~deb12u2" }] }] }] };
    assert.deepEqual(osvSeverity(debian, "openssl"), { severity: "high", score: null });
    assert.equal(osvFixedVersion(debian, "openssl", "Debian:12"), "3.0.14-1~deb12u2");
    assert.equal(primaryId(debian), "CVE-2024-1");
    assert.deepEqual(osvSeverity({ id: "X", severity: [{ type: "Ubuntu", score: "medium" }] }, "x"), { severity: "medium", score: null });
    assert.equal(primaryId({ id: "ALPINE-CVE-2024-5535", upstream: ["CVE-2024-5535"] }), "CVE-2024-5535");
    assert.equal(primaryId({ id: "DEBIAN-CVE-2024-45491" }), "CVE-2024-45491");
    assert.equal(primaryId({ id: "RLSA-2024:2447" }), "RLSA-2024:2447");
    const ubuntu = { id: "UBUNTU-CVE-2024-1", affected: [
      { package: { name: "curl", ecosystem: "Ubuntu:14.04:LTS" }, ranges: [{ type: "ECOSYSTEM", events: [{ introduced: "0" }, { fixed: "7.35.0-1ubuntu2.20+esm22" }] }] },
      { package: { name: "curl", ecosystem: "Ubuntu:24.04:LTS" }, ranges: [{ type: "ECOSYSTEM", events: [{ introduced: "0" }, { fixed: "8.5.0-2ubuntu10.6" }] }] },
    ] };
    assert.equal(osvFixedVersion(ubuntu, "curl", "Ubuntu:24.04:LTS"), "8.5.0-2ubuntu10.6", "fix must come from the host's own release");
  });

  it("accepts gzip agent bodies", async () => {
    const body = zlib.gzipSync(JSON.stringify({ hello: "world" }));
    const req = new Request("http://x", { method: "POST", body, headers: { "content-encoding": "gzip" } });
    assert.deepEqual(await readAgentBody(req), { hello: "world" });
  });
});
