import { z } from "zod";
import { isCalendarDate } from "../dates.ts";
import {
  money,
  optionalRef,
  optionalText,
  requiredRef,
} from "../inventory/fields.ts";

const amount = money("Amount").refine(
  (value) => value !== "0.00",
  "Amount must be greater than zero.",
);
const date = z
  .string()
  .refine(isCalendarDate, "Enter a valid date (YYYY-MM-DD).");
export const expenseSchema = z.strictObject({
  title: z.string().trim().min(1, "Title is required.").max(160),
  categoryId: optionalRef("expense category").optional().default(null),
  amount,
  expenseDate: date,
  note: optionalText(2000, "Note").optional().default(null),
});
export const paymentSchema = z.strictObject({
  supplierId: requiredRef("supplier"),
  amount,
  paymentDate: date,
  note: optionalText(2000, "Note").optional().default(null),
});
export const expensePatchSchema = expenseSchema
  .partial()
  .extend({
    categoryId: optionalRef("expense category").optional(),
    note: optionalText(2000, "Note").optional(),
  })
  .refine(
    (v) => Object.keys(v).length > 0,
    "Send at least one field to update.",
  );
export const paymentPatchSchema = paymentSchema
  .partial()
  .extend({
    note: optionalText(2000, "Note").optional(),
  })
  .refine(
    (v) => Object.keys(v).length > 0,
    "Send at least one field to update.",
  );
export const financeListSchema = z
  .strictObject({
    page: z.coerce.number().int().min(1).max(100000).default(1),
    limit: z.coerce.number().int().min(1).max(100).default(20),
    from: date.optional(),
    to: date.optional(),
    categoryId: requiredRef("category").optional(),
    supplierId: requiredRef("supplier").optional(),
    search: z.string().trim().max(160).default(""),
  })
  .refine(
    (v) => !v.from || !v.to || v.from <= v.to,
    "Start date must not be after end date.",
  );

export interface ExpenseResponse {
  id: string;
  title: string;
  categoryId: string | null;
  amount: string;
  expenseDate: string;
  note: string | null;
  createdBy: string;
  createdAt: string;
}
export interface PaymentResponse {
  id: string;
  supplierId: string;
  amount: string;
  paymentDate: string;
  note: string | null;
  createdBy: string;
  createdAt: string;
}
