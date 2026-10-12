import type { Metadata } from "next";
import { UsersView } from "./users-view";

export const metadata: Metadata = { title: "Users & roles" };

export default function UsersPage() {
  return <UsersView />;
}
