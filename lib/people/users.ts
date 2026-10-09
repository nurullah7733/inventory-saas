import { z } from "zod";

export const STAFF_ROLES = ["manager", "staff"] as const;
export type StaffRole = (typeof STAFF_ROLES)[number];
const fields = {
  name: z.string().trim().min(1, "Name is required.").max(120),
  email: z.string().trim().toLowerCase().max(254).pipe(z.email("Enter a valid email address.")),
  role: z.enum(STAFF_ROLES),
  isActive: z.boolean(),
};
export const staffCreateSchema = z.strictObject({
  ...fields,
  password: z.string().min(8, "Password must be at least 8 characters.").max(72, "Password must be at most 72 characters.")
    .refine((value) => new TextEncoder().encode(value).length <= 72, "Password must be at most 72 bytes."),
  isActive: fields.isActive.optional().default(true),
});
export const staffPatchSchema = z.strictObject(fields).partial()
  .refine((value) => Object.keys(value).length > 0, "Send at least one field to update.");
export const staffFilterSchema = z.strictObject({
  search: z.string().trim().max(100).default(""),
  status: z.enum(["all", "active", "inactive"]).default("all"),
  role: z.enum(["all", ...STAFF_ROLES]).default("all"),
  page: z.coerce.number().int().min(1).max(100000).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});
export interface StaffUser {
  id: string; name: string; email: string; role: StaffRole; isActive: boolean;
  createdAt: string; updatedAt: string; lastLoginAt: string | null;
}
export interface StaffList {
  users: StaffUser[]; total: number; page: number; pageSize: number;
  shop: { id: string; name: string }; usage: { active: number; max: number };
}
