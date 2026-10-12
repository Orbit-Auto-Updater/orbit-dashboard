"use client";

import { ListChecks } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { elapsed, JobProgress, JobStatusBadge, TriggerBadge, type JobStatus } from "@/components/jobs";
import { Card, EmptyNote, PageHeader, Segmented, Table } from "@/components/ui";
import { ago, useApi, useNow } from "@/lib/client";

type Job = {
  id: string;
  label: string;
  trigger: string;
  status: JobStatus;
  createdBy: string;
  createdAt: number;
  startedAt: number | null;
  finishedAt: number | null;
  servers: { total: number; succeeded: number; failed: number; running: number };
  packages: { installed: number; total: number };
  serverNames: string[];
};

export function JobsView() {
  const [filter, setFilter] = useState<"all" | "active" | "finished">("all");
  const { data, error } = useApi<{ jobs: Job[] }>("/api/jobs", { interval: 2000 });
  const now = useNow(1000);
  if (error && !data) return <EmptyNote>Couldn&apos;t load jobs: {error.message}</EmptyNote>;
  const jobs = (data?.jobs ?? []).filter((j) => filter === "all" || (filter === "active" ? j.status === "running" || j.status === "queued" : j.status !== "running" && j.status !== "queued"));

  return (
    <div className="space-y-6">
      <PageHeader title="Jobs" description="Update installs, started from the dashboard or by an auto-update policy. Open one to follow it live." />
      <Card>
        <div className="mb-4 flex items-center justify-between gap-3">
          <Segmented size="sm" value={filter} onChange={setFilter} options={[{ value: "all", label: "All" }, { value: "active", label: "Running" }, { value: "finished", label: "Finished" }]} />
        </div>
        {!data ? (
          <p className="text-sm text-muted">Loading…</p>
        ) : jobs.length === 0 ? (
          <EmptyNote>
            <ListChecks className="mx-auto mb-2 size-5" />
            No jobs yet. Installing updates from the Updates, Servers or Vulnerabilities pages creates one.
          </EmptyNote>
        ) : (
          <Table>
            <thead>
              <tr>
                <th>Job</th>
                <th>Status</th>
                <th className="w-56">Progress</th>
                <th>Servers</th>
                <th>Started</th>
                <th>Duration</th>
              </tr>
            </thead>
            <tbody>
              {jobs.map((j) => (
                <tr key={j.id} className="cursor-pointer" onClick={() => (window.location.href = `/jobs/${j.id}`)}>
                  <td>
                    <Link href={`/jobs/${j.id}`} className="font-medium hover:underline">
                      {j.label}
                    </Link>
                    <p className="mt-0.5 flex items-center gap-1.5 text-[11px] text-subtle">
                      <TriggerBadge trigger={j.trigger} /> by {j.createdBy}
                    </p>
                  </td>
                  <td>
                    <JobStatusBadge status={j.status} />
                  </td>
                  <td>
                    <JobProgress done={j.packages.installed} total={j.packages.total} status={j.status} />
                    <p className="tabular mt-1 text-[11px] text-subtle">
                      {j.packages.installed}
                      {j.packages.total ? ` / ${j.packages.total}` : ""} packages
                    </p>
                  </td>
                  <td className="text-xs text-muted">
                    <span className="tabular">
                      {j.servers.succeeded}/{j.servers.total} done
                      {j.servers.failed ? <span className="text-crit"> · {j.servers.failed} failed</span> : null}
                    </span>
                    <p className="max-w-56 truncate text-[11px] text-subtle">{j.serverNames.join(", ")}</p>
                  </td>
                  <td className="text-xs whitespace-nowrap text-muted">{ago(j.createdAt)}</td>
                  <td className="tabular text-xs text-muted">{elapsed(j.startedAt, j.finishedAt, now)}</td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
    </div>
  );
}
