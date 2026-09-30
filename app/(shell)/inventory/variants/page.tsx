import type { Metadata } from "next";
import { VariantOptionsManager } from "@/components/inventory/variant-options-manager.tsx";

export const metadata: Metadata = {
  title: "Variant options",
};

export default function VariantOptionsPage() {
  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Variant options</h1>
        <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
          The colors, sizes, weights and units your products choose from.
          Define each one once here, then pick it from a dropdown when adding
          a product.
        </p>
      </div>

      <VariantOptionsManager />
    </div>
  );
}
