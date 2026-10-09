import type { Metadata } from "next";
import { UsersManager } from "@/components/people/users-manager.tsx";
export const metadata: Metadata = { title: "Users" };
export default function UsersPage() {
  return <div className="ui-stack"><div><h1 className="text-xl font-semibold tracking-tight">Users</h1>
    <p className="mt-tight text-sm text-muted">Manage your shop&apos;s staff and managers. Deactivate accounts to preserve their history.</p></div><UsersManager /></div>;
}
