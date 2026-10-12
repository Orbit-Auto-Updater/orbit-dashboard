import type { Metadata } from "next";
import { Suspense } from "react";
import { InviteView } from "./invite-view";

export const metadata: Metadata = { title: "Accept invite" };

export default function InvitePage() {
  return (
    <Suspense>
      <InviteView />
    </Suspense>
  );
}
