import { z } from "zod";

const categoryName = z
  .string({ error: "Category name is required." })
  .trim()
  .min(1, "Category name is required.")
  .max(80, "Category name must be at most 80 characters.");

// Same rule as the business logo: a hosted URL until uploads to our own
// storage exist, and never a `javascript:` or `data:` URL.
const imageUrl = z
  .string()
  .trim()
  .max(2048, "Image URL must be at most 2048 characters.")
  .nullable()
  .transform((value) => (value === null || value === "" ? null : value))
  .refine(
    (value) => value === null || /^https?:\/\//i.test(value),
    "Image URL must start with http:// or https://",
  );

export const categorySchema = z.strictObject({
  name: categoryName,
  imageUrl: imageUrl.optional().default(null),
});

export type CategoryInput = z.input<typeof categorySchema>;

export const categoryPatchSchema = z
  .strictObject({
    name: categoryName,
    imageUrl,
    isActive: z.boolean({ error: "isActive must be true or false." }),
  })
  .partial()
  .refine(
    (value) => Object.keys(value).length > 0,
    "Send at least one field to update.",
  );

export type CategoryPatch = z.output<typeof categoryPatchSchema>;

export const CATEGORY_STATUSES = ["all", "active", "archived"] as const;
export type CategoryStatus = (typeof CATEGORY_STATUSES)[number];

export interface CategoryResponse {
  id: string;
  name: string;
  imageUrl: string | null;
  isActive: boolean;
  /** Products (including soft-deleted ones) in this category. */
  productCount: number;
  createdAt: string;
  updatedAt: string;
}
