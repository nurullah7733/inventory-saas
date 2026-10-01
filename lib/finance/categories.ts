import { z } from "zod";

const categoryName = z
  .string({ error: "Category name is required." })
  .trim()
  .min(1, "Category name is required.")
  .max(80, "Category name must be at most 80 characters.");

export const categorySchema = z.strictObject({
  name: categoryName,
});

export type CategoryInput = z.input<typeof categorySchema>;

export const categoryPatchSchema = z
  .strictObject({
    name: categoryName,
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
  isActive: boolean;
  /** Expenses referencing this category. */
  expenseCount: number;
  createdAt: string;
  updatedAt: string;
}
