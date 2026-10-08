import type { Metadata } from "next";
import { PurchaseReturnsManager } from "@/components/inventory/purchase-returns-manager.tsx";

export const metadata: Metadata = { title: "Purchase returns" };
export default function PurchaseReturnsPage() {
  return <div className="space-y-4">
    <div><h1 className="text-xl font-semibold tracking-tight">Purchase returns</h1>
      <p className="mt-1 text-sm text-zinc-500">Return goods from an original supplier purchase. Stock and supplier payable are reduced together.</p></div>
    <PurchaseReturnsManager />
  </div>;
}
