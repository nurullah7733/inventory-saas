import { z } from "zod";
import type { AuthUserPayload } from "../auth/payload.ts";

export const profileDetailsSchema = z.strictObject({
  name: z.string().trim().min(1, "Name is required.").max(120, "Name must be at most 120 characters."),
  email: z.string().trim().min(1, "Email is required.").max(254).toLowerCase().pipe(z.email("Enter a valid email address.")),
});
export const profilePatchSchema = profileDetailsSchema.partial().extend({
  photoUrl: z.string().trim().max(2048).pipe(z.url({ protocol: /^https?$/ })).nullable().optional(),
}).refine((data) => Object.keys(data).length > 0, "Change at least one profile field.");
export type ProfilePatch = z.output<typeof profilePatchSchema>;
export interface ProfileResponse { user: AuthUserPayload }

/** Only an image uploaded into this account's own profile prefix can be saved. */
export function isOwnProfilePhoto(url: string, tenantId: string | null, userId: string, origin: string): boolean {
  if (!tenantId) return false;
  try {
    const parsed = new URL(url);
    const local = parsed.origin === origin && parsed.pathname.startsWith("/media/");
    const blob = parsed.protocol === "https:" && /^[a-z0-9-]+\.public\.blob\.vercel-storage\.com$/.test(parsed.hostname);
    if ((!local && !blob) || parsed.username || parsed.password || parsed.search || parsed.hash) return false;
    const key = local ? parsed.pathname.slice("/media/".length) : parsed.pathname.slice(1);
    const prefix = `tenants/${tenantId}/profile/${userId}/`;
    return key.startsWith(prefix) && /^[0-9a-f-]{36}\.(jpg|png|webp)$/.test(key.slice(prefix.length));
  } catch { return false; }
}
