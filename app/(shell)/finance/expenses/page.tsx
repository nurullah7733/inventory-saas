import type { Metadata } from "next";
import { EntriesManager } from "@/components/finance/entries-manager.tsx";
export const metadata: Metadata = { title: "Expenses" };
export default function Page() {
  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-xl font-semibold">Expenses</h1>
        <p className="mt-1 text-sm text-zinc-500">
          Record and manage operating costs for your shop.
        </p>
      </div>
      <EntriesManager kind="expenses" />
    </div>
  );
}
