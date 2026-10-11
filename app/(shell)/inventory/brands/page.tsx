import type { Metadata } from "next";
import { BrandsManager } from "@/components/inventory/brands-manager.tsx";

export const metadata: Metadata = {
  title: "Brands",
};

export default function BrandsPage() {
  return (
    <div className="ui-stack">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Brands</h1>
        <p className="mt-tight text-sm text-zinc-500 dark:text-zinc-400">
          Manage the brands you sell. A brand that products still use can be
          archived instead of deleted — it stops appearing on the product form
          but keeps its products intact.
        </p>
      </div>

      <BrandsManager />
    </div>
  );
}
