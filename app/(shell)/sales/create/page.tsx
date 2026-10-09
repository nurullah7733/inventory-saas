import type { Metadata } from "next";
import { InvoiceEditor } from "@/components/sales/invoice-editor.tsx";
export const metadata: Metadata = { title: "Create invoice" };
export default function CreateInvoicePage() {
  return <div className="space-y-content"><h1 className="text-xl font-semibold">Create invoice</h1><InvoiceEditor /></div>;
}
