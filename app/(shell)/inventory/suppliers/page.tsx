import type { Metadata } from "next";
import { SuppliersManager } from "@/components/inventory/suppliers-manager.tsx";

export const metadata: Metadata = {
  title: "Suppliers",
};

export default function SuppliersPage() {
  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Suppliers</h1>
        <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
          The wholesalers and vendors you buy stock from. A supplier with
          purchase history cannot be deleted — mark it inactive instead and its
          history stays intact.
        </p>
      </div>

      <SuppliersManager />
    </div>
  );
}
