export interface CommissionRow {
  userId: string;
  name: string;
  role: string;
  isActive: boolean;
  invoiceCount: number;
  soldQuantity: string;
  returnedQuantity: string;
  eligibleSales: string;
  enabled: boolean;
  target: string;
  rate: string;
  earned: string;
  paid: string;
  outstanding: string;
  overpaid: string;
}
export interface CommissionReport {
  availableToPay: string | null;
  month: string;
  canManage: boolean;
  policyEditable: boolean;
  rows: CommissionRow[];
  products: { productId: string; name: string; variant: string; quantity: string; returned: string }[];
  productTotal: number;
  page: number;
  payments: { id: string; userId: string; amount: string; note: string | null; createdAt: string }[];
}
