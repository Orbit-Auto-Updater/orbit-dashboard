import { AppShell } from "@/components/shell";
import { MeProvider } from "@/lib/client";

export default function AppLayout({ children }: LayoutProps<"/">) {
  return (
    <MeProvider>
      <AppShell>{children}</AppShell>
    </MeProvider>
  );
}
