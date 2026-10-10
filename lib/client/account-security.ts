import type { AuthSessionPayload } from "../auth/payload.ts";
import type { ChangePasswordInput, EnablePinInput } from "../auth/schemas.ts";
import type { ProfileResponse } from "../profile/schema.ts";
import { apiRequest, awaitPendingSessionRefresh } from "./api.ts";
import { readSession, replaceSessionTokens, storeSession, updateSessionUser } from "./session.ts";

export interface PasswordChangeResponse {
  passwordChanged: boolean;
  sessionsRevoked: boolean;
  tokens: AuthSessionPayload["tokens"] | null;
}
export async function changeAccountPassword(input: ChangePasswordInput) {
  const result = await apiRequest<PasswordChangeResponse>("/auth/password", { method: "PUT", body: input });
  if (result.tokens) replaceSessionTokens(result.tokens);
  return result;
}
export async function setAccountPin(input: EnablePinInput | { password: string }, enabled: boolean): Promise<ProfileResponse> {
  const result = await apiRequest<{ pinEnabled: boolean }>("/auth/pin", { method: enabled ? "PUT" : "DELETE", body: input });
  const current = readSession();
  if (!current) throw new Error("Sign in again to continue.");
  const user = { ...current.user, pinEnabled: result.pinEnabled };
  updateSessionUser(user);
  return { user };
}
export async function unlockWithPin(pin: string) {
  await awaitPendingSessionRefresh();
  const current = readSession();
  if (!current) throw new Error("Your device session has expired. Sign in with your password.");
  const payload = await apiRequest<AuthSessionPayload>("/auth/pin/unlock", { method: "POST", body: { pin, refreshToken: current.refreshToken }, anonymous: true });
  storeSession(payload);
  return payload;
}
