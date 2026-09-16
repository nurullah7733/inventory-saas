import { z } from "zod";

export const INVOICE_TYPES = ["standard", "thermal", "a4"] as const;
export type InvoiceType = (typeof INVOICE_TYPES)[number];

export const INVOICE_TYPE_LABELS: Record<InvoiceType, string> = {
  standard: "Standard (A5 receipt)",
  thermal: "Thermal / POS roll (80mm)",
  a4: "A4 tax invoice",
};

function optionalText(max: number, label: string) {
  return z
    .string()
    .trim()
    .max(max, `${label} must be at most ${max} characters.`)
    .nullable()
    .transform((value) => (value === null || value === "" ? null : value));
}

const businessName = z
  .string()
  .trim()
  .min(2, "Business name must be at least 2 characters.")
  .max(160, "Business name must be at most 160 characters.");

const businessEmail = z
  .string()
  .trim()
  .min(1, "Email is required.")
  .max(254, "Email is too long.")
  .toLowerCase()
  .pipe(z.email("Enter a valid email address."));

const logoUrl = z
  .string()
  .trim()
  .max(2048, "Logo URL must be at most 2048 characters.")
  .nullable()
  .transform((value) => (value === null || value === "" ? null : value))
  .refine(
    (value) => value === null || /^https:\/\/|^http:\/\//i.test(value),
    "Logo URL must start with http:// or https://",
  );

const vatPercentage = z
  .number({ error: "VAT percentage is required." })
  .min(0, "VAT percentage cannot be negative.")
  .max(100, "VAT percentage cannot be more than 100.")
  .multipleOf(0.01, "VAT percentage can have at most 2 decimal places.");

const lowStockThreshold = z
  .number({ error: "Low stock threshold is required." })
  .int("Low stock threshold must be a whole number.")
  .min(0, "Low stock threshold cannot be negative.")
  .max(1_000_000, "Low stock threshold is unrealistically large.");

const currencySymbol = z
  .string()
  .trim()
  .min(1, "Currency symbol is required.")
  .max(8, "Currency symbol must be at most 8 characters.");

export const businessSettingsSchema = z.strictObject({
  name: businessName,
  description: optionalText(500, "Description"),
  logoUrl,
  email: businessEmail,
  phone: optionalText(32, "Phone"),
  address: optionalText(500, "Address"),
  vatPercentage,
  lowStockThreshold,
  currencySymbol,
  invoiceType: z.enum(INVOICE_TYPES, {
    error: "Choose one of the available invoice types.",
  }),
});

export type BusinessSettingsInput = z.input<typeof businessSettingsSchema>;

export type BusinessSettings = z.output<typeof businessSettingsSchema>;

export const businessSettingsPatchSchema = businessSettingsSchema
  .partial()
  .refine(
    (value) => Object.keys(value).length > 0,
    "Send at least one setting to update.",
  );

export type BusinessSettingsPatch = z.output<
  typeof businessSettingsPatchSchema
>;

export const BUSINESS_SETTINGS_FIELDS = [
  "name",
  "description",
  "logoUrl",
  "email",
  "phone",
  "address",
  "vatPercentage",
  "lowStockThreshold",
  "currencySymbol",
  "invoiceType",
] as const satisfies readonly (keyof BusinessSettings)[];

export interface BusinessSettingsResponse {
  name: string;
  description: string | null;
  logoUrl: string | null;
  email: string;
  phone: string | null;
  address: string | null;
  vatPercentage: string;
  lowStockThreshold: number;
  currencySymbol: string;
  invoiceType: string;
  updatedAt: string;
}
