import type { Metadata } from "next";
import { InvoiceList } from "@/components/sales/invoice-list.tsx";
export const metadata: Metadata = { title: "Draft invoices" };
export default function DraftsPage() {
  return <div className="space-y-content"><h1 className="text-xl font-semibold">Draft invoices</h1><p className="text-sm text-zinc-500">Open a draft to edit its cart or complete the sale. Stock is deducted only on completion.</p><InvoiceList status="draft" /></div>;
}
