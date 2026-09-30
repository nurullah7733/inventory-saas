import { z } from "zod";
import { money, optionalRef, optionalText, quantity, requiredRef } from "../inventory/fields.ts";

export const invoiceSchema = z.object({
  requestId: z.string().uuid().transform((id) => id.toLowerCase()).optional(),
  customerId: optionalRef("customer").default(null),
  status: z.enum(["draft", "completed"]),
  discount: money("Discount").default("0.00"),
  paidAmount: money("Paid amount").default("0.00"),
  paymentMethod: z.enum(["cash", "card", "bank", "mobile"]).nullable().default(null),
  items: z.array(z.object({
    productId: requiredRef("product").transform((id) => id.toLowerCase()),
    quantity: quantity("Quantity"),
    unitPrice: money("Unit price"),
  }).strict()).min(1, "Add at least one product.").max(100, "At most 100 products per invoice."),
}).strict().superRefine((data, ctx) => {
  if (new Set(data.items.map((item) => item.productId)).size !== data.items.length) {
    ctx.addIssue({ code: "custom", path: ["items"], message: "Combine duplicate products into one cart line." });
  }
  if (data.status === "draft" && data.paidAmount !== "0.00") {
    ctx.addIssue({ code: "custom", path: ["paidAmount"], message: "Drafts cannot collect payment." });
  }
});

export const returnSchema = z.object({
  requestId: z.string().uuid().transform((id) => id.toLowerCase()).optional(),
  saleItemId: requiredRef("invoice item"),
  quantity: quantity("Return quantity"),
  reason: optionalText(1000, "Reason").default(null),
}).strict();

export type InvoiceInput = z.output<typeof invoiceSchema>;
export type ReturnInput = z.output<typeof returnSchema>;
