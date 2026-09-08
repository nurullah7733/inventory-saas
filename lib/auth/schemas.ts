import { z } from "zod";

const email = z
  .string()
  .trim()
  .min(1, "Email is required.")
  .max(254, "Email is too long.")
  .toLowerCase()
  .pipe(z.email("Enter a valid email address."));

const password = z
  .string()
  .min(8, "Password must be at least 8 characters.")
  .max(72, "Password must be at most 72 characters.");

const personName = z
  .string()
  .trim()
  .min(1, "Name is required.")
  .max(120, "Name must be at most 120 characters.");

const pin = z
  .string()
  .regex(/^[0-9]{4}$/, "PIN must be exactly 4 digits.")
  .refine(
    (value) => new Set(value).size > 1,
    "PIN cannot be four identical digits.",
  )
  .refine(
    (value) => !isSequential(value),
    "PIN cannot be a simple sequence like 1234 or 4321.",
  );

function isSequential(value: string): boolean {
  const digits = [...value].map(Number);
  const ascending = digits.every((d, i) => i === 0 || d === digits[i - 1] + 1);
  const descending = digits.every((d, i) => i === 0 || d === digits[i - 1] - 1);
  return ascending || descending;
}

const deviceId = z.string().trim().min(1).max(128).optional();

export const signupSchema = z.object({
  businessName: z
    .string()
    .trim()
    .min(2, "Business name must be at least 2 characters.")
    .max(160, "Business name must be at most 160 characters."),
  name: personName,
  email,
  password,
  phone: z.string().trim().max(32).optional(),
  deviceId,
});

export type SignupInput = z.infer<typeof signupSchema>;

// --- Login ------------------------------------------------------------------

export const loginSchema = z.object({
  email,

  password: z.string().min(1, "Password is required.").max(200),
  deviceId,
});

export type LoginInput = z.infer<typeof loginSchema>;

// --- Refresh / logout -------------------------------------------------------

export const refreshSchema = z.object({
  refreshToken: z.string().min(1, "Refresh token is required."),
});

export type RefreshInput = z.infer<typeof refreshSchema>;

export const logoutSchema = z.object({
  refreshToken: z.string().min(1, "Refresh token is required."),

  allDevices: z.boolean().optional().default(false),
});

export type LogoutInput = z.infer<typeof logoutSchema>;

// --- PIN --------------------------------------------------------------------

export const enablePinSchema = z.object({
  password: z.string().min(1, "Your current password is required."),
  pin,
});

export type EnablePinInput = z.infer<typeof enablePinSchema>;

export const disablePinSchema = z.object({
  password: z.string().min(1, "Your current password is required."),
});

export type DisablePinInput = z.infer<typeof disablePinSchema>;

export const pinUnlockSchema = z.object({
  refreshToken: z.string().min(1, "Refresh token is required."),
  pin: z.string().regex(/^[0-9]{4}$/, "PIN must be exactly 4 digits."),
});

export type PinUnlockInput = z.infer<typeof pinUnlockSchema>;

// --- Password change --------------------------------------------------------

export const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1, "Your current password is required."),
    newPassword: password,

    revokeOtherSessions: z.boolean().optional().default(true),
  })
  .refine((value) => value.currentPassword !== value.newPassword, {
    message: "New password must be different from the current one.",
    path: ["newPassword"],
  });

export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;
