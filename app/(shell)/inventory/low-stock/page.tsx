import type { Metadata } from "next";
import { LowStockList } from "@/components/inventory/stock-alerts.tsx";

export const metadata: Metadata = {
  title: "Low stock",
};

export default function LowStockPage() {
  return (
    <div className="ui-stack">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Low stock</h1>
        <p className="mt-tight text-sm text-zinc-500 dark:text-zinc-400">
          Products at or below your low-stock threshold, emptiest first. Change
          the threshold here for a one-off look, or permanently in Business
          settings.
        </p>
      </div>

      <LowStockList />
    </div>
  );
}
