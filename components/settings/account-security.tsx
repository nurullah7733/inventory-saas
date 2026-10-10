"use client";

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { ApiClientError, apiRequest } from "@/lib/client/api.ts";
import { useSession } from "@/lib/client/use-session.ts";
import { lockSession } from "@/lib/client/session.ts";
import { changeAccountPassword, setAccountPin } from "@/lib/client/account-security.ts";
import { CURRENT_TENANT_QUERY_KEY } from "@/lib/client/current-tenant.ts";
import { disablePinSchema } from "@/lib/auth/schemas.ts";
import { passwordChangeFormSchema, pinEnableFormSchema } from "@/lib/auth/security-ui.ts";
import type { ProfileResponse } from "@/lib/profile/schema.ts";
import { zodResolver } from "@/lib/forms/zod-resolver.ts";
import { Button, Field, FormSection } from "@/components/ui/field.tsx";

type PasswordValues = { currentPassword: string; newPassword: string; confirmPassword: string; revokeOtherSessions: boolean };
type PinValues = { password: string; pin: string; confirmPin: string };
const emptyPassword: PasswordValues = { currentPassword: "", newPassword: "", confirmPassword: "", revokeOtherSessions: true };
const emptyPin: PinValues = { password: "", pin: "", confirmPin: "" };

export function AccountSecurity() {
  const { status } = useSession();
  const cache = useQueryClient();
  const [busy, setBusy] = useState<"password" | "pin" | "lock" | null>(null);
  const profile = useQuery({ queryKey: ["profile"], enabled: status === "authenticated",
    queryFn: ({ signal }) => apiRequest<ProfileResponse>("/profile", { signal }) });
  const enabled = profile.data?.user.pinEnabled ?? false;
  const password = useForm<PasswordValues>({ resolver: zodResolver<PasswordValues>(passwordChangeFormSchema), defaultValues: emptyPassword });
  const pin = useForm<PinValues>({ resolver: zodResolver<PinValues>(enabled ? disablePinSchema : pinEnableFormSchema), defaultValues: emptyPin });
  const disabled = !!busy || !profile.data;

  const savePassword = password.handleSubmit(async (values) => {
    setBusy("password");
    try {
      await cache.cancelQueries();
      await changeAccountPassword({ currentPassword: values.currentPassword, newPassword: values.newPassword, revokeOtherSessions: values.revokeOtherSessions });
      password.reset(emptyPassword);
      pin.reset(emptyPin);
      toast.success(values.revokeOtherSessions ? "Password changed. Other devices have been signed out." : "Password changed.");
      void cache.invalidateQueries({ queryKey: ["profile"] });
      void cache.invalidateQueries({ queryKey: CURRENT_TENANT_QUERY_KEY });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Could not change password.";
      password.setError(error instanceof ApiClientError && error.code === "INVALID_CREDENTIALS" ? "currentPassword" : "root", { type: "server", message });
      toast.error(message);
    } finally { setBusy(null); }
  });
  const savePin = pin.handleSubmit(async (values) => {
    setBusy("pin");
    try {
      await cache.cancelQueries({ queryKey: ["profile"] });
      const result = await setAccountPin(enabled ? { password: values.password } : { password: values.password, pin: values.pin }, !enabled);
      cache.setQueryData(["profile"], result);
      pin.reset(emptyPin);
      toast.success(enabled ? "PIN disabled." : "PIN enabled. You can now lock this screen.");
      void cache.invalidateQueries({ queryKey: ["profile"] });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Could not update PIN.";
      pin.setError(error instanceof ApiClientError && error.code === "INVALID_CREDENTIALS" ? "password" : "root", { type: "server", message });
      toast.error(message);
    } finally { setBusy(null); }
  });

  return <section aria-labelledby="account-security-heading" className="ui-stack">
    <div><h2 id="account-security-heading" className="text-xl font-semibold">Account security</h2>
      <p className="mt-tight text-sm text-muted">Manage your password and PIN for quick device unlock.</p></div>
    <form onSubmit={savePassword} noValidate className="ui-stack">
      <FormSection title="Change password" description="Confirm your current password before choosing a new one.">
        <Field label="Current password" required error={password.formState.errors.currentPassword?.message}>
          {(props) => <input {...props} {...password.register("currentPassword")} type="password" autoComplete="current-password" disabled={disabled} />}
        </Field>
        <div className="hidden sm:block" />
        <Field label="New password" required error={password.formState.errors.newPassword?.message} hint="8 to 72 characters; different from your current password.">
          {(props) => <input {...props} {...password.register("newPassword")} type="password" autoComplete="new-password" maxLength={72} disabled={disabled} />}
        </Field>
        <Field label="Confirm new password" required error={password.formState.errors.confirmPassword?.message}>
          {(props) => <input {...props} {...password.register("confirmPassword")} type="password" autoComplete="new-password" maxLength={72} disabled={disabled} />}
        </Field>
        <label className="flex min-h-11 items-center gap-small text-sm sm:col-span-2">
          <input {...password.register("revokeOtherSessions")} type="checkbox" disabled={disabled} className="h-4 w-4 accent-primary" />
          Sign out other devices
        </label>
        {password.formState.errors.root?.message && <p role="alert" className="text-sm text-danger sm:col-span-2">{password.formState.errors.root.message}</p>}
        <div className="sm:col-span-2"><Button type="submit" disabled={disabled}>{busy === "password" ? "Changing password..." : "Change password"}</Button></div>
      </FormSection>
    </form>
    <form onSubmit={savePin} noValidate className="ui-stack">
      <FormSection title="4-digit PIN" description={enabled ? "PIN is enabled. Confirm your password to disable it." : "Enable quick unlock on this device. Password sign-in stays available."}>
        <Field label="Account password" required error={pin.formState.errors.password?.message}>
          {(props) => <input {...props} {...pin.register("password")} type="password" autoComplete="current-password" disabled={disabled} />}
        </Field>
        {!enabled && <>
          <Field label="New PIN" required error={pin.formState.errors.pin?.message} hint="4 digits. Avoid repeated or sequential numbers.">
            {(props) => <input {...props} {...pin.register("pin")} type="password" inputMode="numeric" pattern="[0-9]{4}" maxLength={4} autoComplete="off" disabled={disabled} />}
          </Field>
          <Field label="Confirm PIN" required error={pin.formState.errors.confirmPin?.message}>
            {(props) => <input {...props} {...pin.register("confirmPin")} type="password" inputMode="numeric" pattern="[0-9]{4}" maxLength={4} autoComplete="off" disabled={disabled} />}
          </Field>
        </>}
        {pin.formState.errors.root?.message && <p role="alert" className="text-sm text-danger sm:col-span-2">{pin.formState.errors.root.message}</p>}
        <div className="ui-toolbar sm:col-span-2">
          <Button type="submit" variant={enabled ? "danger" : "primary"} disabled={disabled}>{busy === "pin" ? "Updating PIN..." : enabled ? "Disable PIN" : "Enable PIN"}</Button>
          {enabled && <Button type="button" variant="ghost" disabled={disabled} onClick={async () => {
            setBusy("lock"); await cache.cancelQueries();
            if (!lockSession()) { setBusy(null); toast.error("Sign in again to lock this device."); }
          }}>Lock screen</Button>}
        </div>
      </FormSection>
    </form>
  </section>;
}
