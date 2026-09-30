import { z } from "zod";
import { phone } from "../inventory/fields.ts";

const customerName = z
  .string({ error: "Customer name is required." })
  .trim()
  .min(1, "Customer name is required.")
  .max(120, "Customer name must be at most 120 characters.");

/**
 * Separators people type inside a phone number. They are stripped before a
 * phone is stored, so the `(tenant_id, phone)` unique index sees
 * "01711-000000" and "01711 000000" as the same customer.
 */
const PHONE_SEPARATORS = /[\s\-().]/g;

export function normalizePhone(value: string): string {
  return value.replace(PHONE_SEPARATORS, "");
}

const customerPhone = phone.transform((value) => {
  if (value === null) return null;
  const digits = normalizePhone(value);
  return digits === "" ? null : digits;
});

export const customerSchema = z.strictObject({
  name: customerName,
  phone: customerPhone.optional().default(null),
});

export type CustomerInput = z.input<typeof customerSchema>;

export const customerPatchSchema = z
  .strictObject({
    name: customerName,
    phone: customerPhone,
    isActive: z.boolean({ error: "isActive must be true or false." }),
  })
  .partial()
  .refine(
    (value) => Object.keys(value).length > 0,
    "Send at least one field to update.",
  );

export type CustomerPatch = z.output<typeof customerPatchSchema>;

export const CUSTOMER_STATUSES = ["all", "active", "inactive"] as const;
export type CustomerStatus = (typeof CUSTOMER_STATUSES)[number];

export interface CustomerResponse {
  id: string;
  name: string;
  phone: string | null;
  isActive: boolean;
  saleCount: number;
  createdAt: string;
  updatedAt: string;
}
