export interface InvoiceSummary {
  id: string;
  invoiceNo: string;
  status: "draft" | "completed";
  customer: { id: string; name: string; phone: string | null } | null;
  subtotal: string;
  discount: string;
  vatAmount: string;
  totalAmount: string;
  paidAmount: string;
  paymentMethod: string | null;
  creditAmount: string;
  netAmount: string;
  dueAmount: string;
  cashRefundAmount: string;
  createdAt: string;
  updatedAt: string;
}
export interface InvoiceItem {
  id: string;
  productId: string;
  name: string;
  sku: string;
  quantity: number;
  unitPrice: string;
  unitCost: string;
  subtotal: string;
  returnedQuantity: number;
  returnableQuantity: number;
  lineCredit: string;
}
export interface InvoiceDetail extends InvoiceSummary { items: InvoiceItem[] }
export interface InvoiceList { invoices: InvoiceSummary[]; total: number; page: number; pageSize: number }
export interface ReturnEntry {
  id: string;
  saleId: string;
  invoiceNo: string;
  saleItemId: string;
  productName: string;
  quantity: number;
  reason: string | null;
  refundAmount: string;
  createdAt: string;
}
export interface ReturnList { returns: ReturnEntry[]; total: number; page: number; pageSize: number }
