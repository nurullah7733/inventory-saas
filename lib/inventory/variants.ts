import { z } from "zod";

/**
 * The four variant master lists from the brief. The URL segment
 * (`/api/v1/variants/colors`) is the kind, so web, Android and iOS clients all
 * address a list the same way.
 */
export const VARIANT_KINDS = ["colors", "sizes", "weights", "units"] as const;
export type VariantKind = (typeof VARIANT_KINDS)[number];

export function isVariantKind(value: string): value is VariantKind {
  return (VARIANT_KINDS as readonly string[]).includes(value);
}

export const VARIANT_KIND_LABELS: Record<
  VariantKind,
  { plural: string; singular: string; placeholder: string }
> = {
  colors: { plural: "Colors", singular: "Color", placeholder: "e.g. Black" },
  sizes: { plural: "Sizes", singular: "Size", placeholder: "e.g. 42 or XL" },
  weights: { plural: "Weights", singular: "Weight", placeholder: "e.g. 500 g" },
  units: { plural: "Units", singular: "Unit", placeholder: "e.g. pcs, kg, box" },
};

/** One schema for create and rename — a variant option is only a name. */
export const variantOptionSchema = z.strictObject({
  name: z
    .string({ error: "Name is required." })
    .trim()
    .min(1, "Name is required.")
    .max(60, "Name must be at most 60 characters."),
});

export type VariantOptionInput = z.input<typeof variantOptionSchema>;

export interface VariantOptionResponse {
  id: string;
  name: string;
  /**
   * Products (including soft-deleted ones) pointing at this option. Non-zero
   * means delete will be refused, so the UI can say so before the user tries.
   */
  productCount: number;
  createdAt: string;
}
