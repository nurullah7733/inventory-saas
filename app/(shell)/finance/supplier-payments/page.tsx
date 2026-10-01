import type { Metadata } from "next";
import { EntriesManager } from "@/components/finance/entries-manager.tsx";
export const metadata: Metadata = { title: "Supplier payments" };
export default function Page() {
  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-xl font-semibold">Supplier payments</h1>
        <p className="mt-1 text-sm text-zinc-500">
          Record and manage payments made to suppliers.
        </p>
      </div>
      <EntriesManager kind="supplier-payments" />
    </div>
  );
}
