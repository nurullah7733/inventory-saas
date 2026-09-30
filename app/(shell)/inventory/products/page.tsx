import type { Metadata } from "next";
import { ProductsManager } from "@/components/inventory/products-manager.tsx";

export const metadata: Metadata = {
  title: "Products",
};

export default function ProductsPage() {
  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Products</h1>
        <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
          Everything you sell. Search by name or SKU, pick colors, sizes and
          units from your variant lists, and add stock from each product.
          Deleted products are kept for their sales history and can be restored.
        </p>
      </div>

      <ProductsManager />
    </div>
  );
}
