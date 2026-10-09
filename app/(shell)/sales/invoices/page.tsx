import type { Metadata } from "next";
import { InvoiceList } from "@/components/sales/invoice-list.tsx";
export const metadata: Metadata = { title: "Invoices" };
export default function InvoicesPage() {
  return <div className="space-y-content"><h1 className="text-xl font-semibold">Invoices</h1><InvoiceList status="completed" /></div>;
}
