import { z } from "zod";
import { decimalQuantity, money, optionalRef, optionalText, requiredRef } from "../inventory/fields.ts";

export const invoiceSchema = z.object({
  requestId: z.string().uuid().transform((id) => id.toLowerCase()).optional(),
  customerId: optionalRef("customer").default(null),
  status: z.enum(["draft", "completed"]),
  discount: money("Discount").default("0.00"),
  discountPercentage: money("Discount percentage")
    .refine((value) => Number(value) <= 100, "Discount percentage must be between 0 and 100.").optional(),
  paidAmount: money("Paid amount").default("0.00"),
  paymentMethod: z.enum(["cash", "card", "bank", "mobile"]).nullable().default(null),
  items: z.array(z.object({
    productId: requiredRef("product").transform((id) => id.toLowerCase()),
    /**
     * Which variant of the product is sold. Omit for a single-variant
     * product — the server resolves its Default variant; a multi-variant
     * product without a choice is refused.
     */
    variantId: optionalRef("variant")
      .transform((id) => (id ? id.toLowerCase() : null))
      .default(null),
    quantity: decimalQuantity("Quantity", { min: 0.001 }),
    unitPrice: money("Unit price"),
  }).strict()).min(1, "Add at least one product.").max(100, "At most 100 products per invoice."),
}).strict().superRefine((data, ctx) => {
  if (new Set(data.items.map((item) => `${item.productId}:${item.variantId ?? ""}`)).size !== data.items.length) {
    ctx.addIssue({ code: "custom", path: ["items"], message: "Combine duplicate product lines into one cart line." });
  }
  if (data.status === "draft" && data.paidAmount !== "0.00") {
    ctx.addIssue({ code: "custom", path: ["paidAmount"], message: "Drafts cannot collect payment." });
  }
});

export const returnSchema = z.object({
  requestId: z.string().uuid().transform((id) => id.toLowerCase()).optional(),
  saleItemId: requiredRef("invoice item"),
  quantity: decimalQuantity("Return quantity", { min: 0.001 }),
  reason: optionalText(1000, "Reason").default(null),
}).strict();

export type InvoiceInput = z.output<typeof invoiceSchema>;
export type ReturnInput = z.output<typeof returnSchema>;
