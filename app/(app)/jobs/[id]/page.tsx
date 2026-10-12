import type { Metadata } from "next";
import { Suspense } from "react";
import { JobView } from "./job-view";

export const metadata: Metadata = { title: "Job" };

export default function JobPage() {
  return (
    <Suspense>
      <JobView />
    </Suspense>
  );
}
