import type { Metadata } from "next";
import { CategoriesManager } from "@/components/inventory/categories-manager.tsx";

export const metadata: Metadata = {
  title: "Categories",
};

export default function CategoriesPage() {
  return (
    <div className="ui-stack">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Categories</h1>
        <p className="mt-tight text-sm text-zinc-500 dark:text-zinc-400">
          Group your products. A category that products still use can be
          archived instead of deleted — it stops appearing on the product form
          but keeps its products intact.
        </p>
      </div>

      <CategoriesManager />
    </div>
  );
}
