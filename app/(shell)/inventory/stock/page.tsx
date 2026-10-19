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
          Deliveries grouped by product. Expand a product to see its sizes,
          colors, received quantities and delivery details.
        </p>
      </div>

      <StockManager />
    </div>
  );
}
