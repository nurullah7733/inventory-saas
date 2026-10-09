import type { Metadata } from "next";
import { NearExpiryList } from "@/components/inventory/stock-alerts.tsx";

export const metadata: Metadata = {
  title: "Near expiry",
};

export default function NearExpiryPage() {
  return (
    <div className="ui-stack">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Near expiry</h1>
        <p className="mt-tight text-sm text-zinc-500 dark:text-zinc-400">
          Products in stock that have expired or will soon, soonest first. Write
          off what can no longer be sold.
        </p>
      </div>

      <NearExpiryList />
    </div>
  );
}
