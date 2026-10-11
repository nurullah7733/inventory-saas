import { z } from "zod";

const brandName = z
  .string({ error: "Brand name is required." })
  .trim()
  .min(1, "Brand name is required.")
  .max(80, "Brand name must be at most 80 characters.");

export const brandSchema = z.strictObject({
  name: brandName,
});

export type BrandInput = z.input<typeof brandSchema>;

export const brandPatchSchema = z
  .strictObject({
    name: brandName,
    isActive: z.boolean({ error: "isActive must be true or false." }),
  })
  .partial()
  .refine(
    (value) => Object.keys(value).length > 0,
    "Send at least one field to update.",
  );

export type BrandPatch = z.output<typeof brandPatchSchema>;

export const BRAND_STATUSES = ["all", "active", "archived"] as const;
export type BrandStatus = (typeof BRAND_STATUSES)[number];

export interface BrandResponse {
  id: string;
  name: string;
  isActive: boolean;
  /** Products (including soft-deleted ones) in this brand. */
  productCount: number;
  createdAt: string;
  updatedAt: string;
}
