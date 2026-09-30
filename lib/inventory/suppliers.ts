import { z } from "zod";
import { optionalText, phone } from "./fields.ts";

const supplierName = z
  .string({ error: "Supplier name is required." })
  .trim()
  .min(1, "Supplier name is required.")
  .max(120, "Supplier name must be at most 120 characters.");

export const supplierSchema = z.strictObject({
  name: supplierName,
  phone: phone.optional().default(null),
  address: optionalText(500, "Address").optional().default(null),
});

export type SupplierInput = z.input<typeof supplierSchema>;

export const supplierPatchSchema = z
  .strictObject({
    name: supplierName,
    phone,
    address: optionalText(500, "Address"),
    isActive: z.boolean({ error: "isActive must be true or false." }),
  })
  .partial()
  .refine(
    (value) => Object.keys(value).length > 0,
    "Send at least one field to update.",
  );

export type SupplierPatch = z.output<typeof supplierPatchSchema>;

export const SUPPLIER_STATUSES = ["all", "active", "inactive"] as const;
export type SupplierStatus = (typeof SUPPLIER_STATUSES)[number];

export interface SupplierResponse {
  id: string;
  name: string;
  phone: string | null;
  address: string | null;
  isActive: boolean;
  /**
   * Stock entries and payments that reference this supplier. Either being
   * non-zero means delete is refused — purchase history must stay intact —
   * so the UI offers "mark inactive" instead.
   */
  stockEntryCount: number;
  paymentCount: number;
  createdAt: string;
  updatedAt: string;
}
