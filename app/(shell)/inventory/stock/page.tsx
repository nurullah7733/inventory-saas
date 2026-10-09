import type { Metadata } from "next";
import { StockManager } from "@/components/inventory/stock-manager.tsx";

export const metadata: Metadata = {
  title: "Stock",
};

export default function StockPage() {
  return (
    <div className="ui-stack">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Stock</h1>
        <p className="mt-tight text-sm text-zinc-500 dark:text-zinc-400">
          Every delivery you have received. Adding stock raises the product&apos;s
          quantity and records the supplier, unit cost and who received it.
        </p>
      </div>

      <StockManager />
    </div>
  );
}
