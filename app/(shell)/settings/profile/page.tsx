import type { Metadata } from "next";
import { ProfileForm } from "@/components/settings/profile-form.tsx";
import { AccountSecurity } from "@/components/settings/account-security.tsx";

export const metadata: Metadata = { title: "Profile" };
export default function ProfilePage() {
  return <div className="ui-stack">
    <div><h1 className="text-xl font-semibold tracking-tight">Profile</h1>
      <p className="mt-tight text-sm text-muted">Manage your name, email and profile photo.</p></div>
    <ProfileForm />
    <AccountSecurity />
  </div>;
}
