import { z } from "zod";
import { signupSchema } from "./schemas.ts";

export const forgotPasswordSchema = z.strictObject({ email: signupSchema.shape.email });
export const resetPasswordSchema = z.strictObject({
  token: z.string().regex(/^[a-f0-9]{64}$/, "This reset link is invalid. Request a new link."),
  newPassword: signupSchema.shape.password.refine((value) => new TextEncoder().encode(value).length <= 72, "Password must be at most 72 bytes."),
});
export const resetPasswordFormSchema = resetPasswordSchema.extend({ confirmPassword: z.string().min(1, "Confirm your new password.") })
  .refine((value) => value.newPassword === value.confirmPassword, { message: "Passwords do not match.", path: ["confirmPassword"] });
export const RESET_REQUEST_MESSAGE = "If an eligible account uses that email, a password reset link will be sent. Check your inbox and spam folder.";
