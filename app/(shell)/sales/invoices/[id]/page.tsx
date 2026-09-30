import type { Metadata } from "next";
import { InvoiceDetail } from "@/components/sales/invoice-detail.tsx";
export const metadata: Metadata = { title: "Invoice details" };
export default async function InvoicePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <InvoiceDetail id={id} />;
}
