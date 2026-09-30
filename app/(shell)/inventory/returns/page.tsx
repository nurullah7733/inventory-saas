import type { Metadata } from "next";
import { ReturnsList } from "@/components/sales/returns-list.tsx";
export const metadata: Metadata = { title: "Returns" };
export default function ReturnsPage() {
  return <div className="space-y-4"><h1 className="text-xl font-semibold">Returns</h1><p className="text-sm text-zinc-500">Record returned goods against completed invoices and restore their stock.</p><ReturnsList /></div>;
}
