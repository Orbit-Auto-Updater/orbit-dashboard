import { notFound, route } from "@/lib/server/api";
import { requireUser } from "@/lib/server/auth";
import { getDb } from "@/lib/server/db";
import { jobDetail } from "@/lib/server/jobs";

export const GET = route<{ params: Promise<{ id: string }> }>(async (_req, { params }) => {
  await requireUser("metrics.view");
  const job = await jobDetail(await getDb(), (await params).id);
  if (!job) throw notFound("Job not found");
  return job;
});
