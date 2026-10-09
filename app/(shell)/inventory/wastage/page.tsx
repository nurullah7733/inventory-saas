import type { Metadata } from "next";
import { WastageManager } from "@/components/inventory/wastage-manager.tsx";

export const metadata: Metadata = {
  title: "Wastage",
};

export default function WastagePage() {
  return (
    <div className="ui-stack">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Wastage</h1>
        <p className="mt-tight text-sm text-zinc-500 dark:text-zinc-400">
          Damaged, expired or lost stock written off. The loss is valued at cost
          price and reported separately from net profit.
        </p>
      </div>

      <WastageManager />
    </div>
  );
}
