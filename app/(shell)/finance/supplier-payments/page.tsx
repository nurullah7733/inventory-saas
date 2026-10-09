import type { Metadata } from "next";
import { EntriesManager } from "@/components/finance/entries-manager.tsx";
export const metadata: Metadata = { title: "Supplier payments" };
export default function Page() {
  return (
    <div className="ui-stack">
      <div>
        <h1 className="text-xl font-semibold">Supplier payments</h1>
        <p className="mt-tight text-sm text-zinc-500">
          Record and manage payments made to suppliers.
        </p>
      </div>
      <EntriesManager kind="supplier-payments" />
    </div>
  );
}
