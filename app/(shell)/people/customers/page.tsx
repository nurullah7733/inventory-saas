import type { Metadata } from "next";
import { CustomersManager } from "@/components/people/customers-manager.tsx";

export const metadata: Metadata = {
  title: "Customers",
};

export default function CustomersPage() {
  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Customers</h1>
        <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
          The people you sell to. A phone number can belong to only one
          customer in your shop. A customer with invoices cannot be deleted —
          mark them inactive instead and their history stays intact.
        </p>
      </div>

      <CustomersManager />
    </div>
  );
}
