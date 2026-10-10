import { z } from "zod";
import { changePasswordSchema, enablePinSchema } from "./schemas.ts";

export const passwordChangeFormSchema = changePasswordSchema.safeExtend({ confirmPassword: z.string().min(1, "Confirm your new password.") })
  .refine((values) => values.newPassword === values.confirmPassword, { message: "Passwords do not match.", path: ["confirmPassword"] });
export const pinEnableFormSchema = enablePinSchema.extend({ confirmPin: z.string().regex(/^[0-9]{4}$/, "Confirm your 4-digit PIN.") })
  .refine((values) => values.pin === values.confirmPin, { message: "PINs do not match.", path: ["confirmPin"] });
export function safeAccountDestination(next: string | null, role?: string): string {
  if (role === "super_admin") return "/admin";
  return next && /^\/(?!\/)/.test(next) && !/[\\\u0000-\u0020]/.test(next) && !/^\/(?:login|signup|unlock|forgot-password|reset-password)(?:[/?#]|$)/.test(next) ? next : "/dashboard";
}
