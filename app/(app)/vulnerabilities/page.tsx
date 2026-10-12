import type { Metadata } from "next";
import { VulnerabilitiesView } from "./vulnerabilities-view";

export const metadata: Metadata = { title: "Vulnerabilities" };

export default function VulnerabilitiesPage() {
  return <VulnerabilitiesView />;
}
