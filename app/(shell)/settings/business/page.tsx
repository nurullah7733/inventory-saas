import type { Metadata } from "next";
import { BusinessSettingsForm } from "@/components/settings/business-settings-form.tsx";

export const metadata: Metadata = {
  title: "Business settings",
};

export default function BusinessSettingsPage() {
  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">
          Business settings
        </h1>
        <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
          Your shop&apos;s identity, contact details, and the tax and stock
          rules the rest of the app runs on.
        </p>
      </div>

      <BusinessSettingsForm />
    </div>
  );
}
