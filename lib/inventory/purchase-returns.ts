import { z } from "zod";
import { optionalText, quantity, requiredRef } from "./fields.ts";
import type { StockMovementResponse } from "./stock.ts";

export const purchaseReturnSchema = z.strictObject({
  requestId: z.string().uuid().transform((id) => id.toLowerCase()),
  sourceMovementId: requiredRef("purchase entry").transform((id) => id.toLowerCase()),
  quantity: quantity("Return quantity"),
  reason: optionalText(500, "Reason").optional().default(null),
});
export type PurchaseReturnInput = z.output<typeof purchaseReturnSchema>;
export interface PurchaseReceipt extends StockMovementResponse {
  returnedQuantity: number;
  returnableQuantity: number;
  stockQty: number;
  productAvailable: boolean;
}
export interface PurchaseReturnResponse extends StockMovementResponse {
  returnedQuantity: number;
  creditAmount: string;
}
export interface PurchaseReceiptList { purchases: PurchaseReceipt[]; page: number; pageSize: number; total: number }
export interface PurchaseReturnList { returns: PurchaseReturnResponse[]; page: number; pageSize: number; total: number }
