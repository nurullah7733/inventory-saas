import type { Metadata } from "next";
import { CategoriesManager } from "@/components/finance/categories-manager.tsx";
export const metadata: Metadata = { title: "Expense categories" };
export default function Page() {
  return (
    <div className="ui-stack">
      <div>
        <h1 className="text-xl font-semibold">Expense categories</h1>
        <p className="mt-tight text-sm text-zinc-500">
          Organize expenses. Archive used categories to preserve their history.
        </p>
      </div>
      <CategoriesManager />
    </div>
  );
}
