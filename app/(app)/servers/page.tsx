import type { Metadata } from "next";
import { Suspense } from "react";
import { ServersView } from "./servers-view";

export const metadata: Metadata = { title: "Servers" };

export default function ServersPage() {
  return (
    <Suspense>
      <ServersView />
    </Suspense>
  );
}
