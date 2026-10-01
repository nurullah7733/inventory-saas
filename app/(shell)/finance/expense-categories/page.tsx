import type { Metadata } from "next";
import { CategoriesManager } from "@/components/finance/categories-manager.tsx";
export const metadata: Metadata = { title: "Expense categories" };
export default function Page() {
  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-xl font-semibold">Expense categories</h1>
        <p className="mt-1 text-sm text-zinc-500">
          Organize expenses. Archive used categories to preserve their history.
        </p>
      </div>
      <CategoriesManager />
    </div>
  );
}
