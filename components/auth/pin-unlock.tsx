"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { ApiClientError, apiRequest } from "@/lib/client/api.ts";
import { unlockWithPin } from "@/lib/client/account-security.ts";
import { useSession } from "@/lib/client/use-session.ts";
import { clearSession } from "@/lib/client/session.ts";
import { safeAccountDestination } from "@/lib/auth/security-ui.ts";
import { zodResolver } from "@/lib/forms/zod-resolver.ts";
import { Button, Field } from "@/components/ui/field.tsx";

const schema = z.object({ pin: z.string().regex(/^[0-9]{4}$/, "Enter your 4-digit PIN.") });
export function PinUnlock() {
  const { status, session } = useSession();
  const router = useRouter(), params = useSearchParams(), cache = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [blocked, setBlocked] = useState(false);
  const [openedAt] = useState(() => Date.now());
  const form = useForm<{ pin: string }>({ resolver: zodResolver(schema), defaultValues: { pin: "" } });
  const destination = safeAccountDestination(params.get("next"), session?.user.role);
  useEffect(() => {
    if (status === "unauthenticated") { clearSession(); router.replace("/login"); }
    if (status === "authenticated") router.replace(destination);
  }, [status, destination, router]);
  const submit = form.handleSubmit(async ({ pin }) => {
    setBusy(true); form.clearErrors();
    try {
      await unlockWithPin(pin);
      form.reset();
      cache.clear();
      router.replace(destination);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Could not unlock. Try again.";
      form.setError("pin", { type: "server", message });
      form.resetField("pin", { keepError: true });
      if (error instanceof ApiClientError && ["PIN_LOCKED", "PIN_NOT_SET", "UNAUTHENTICATED", "ACCOUNT_DISABLED", "TENANT_SUSPENDED", "RATE_LIMITED"].includes(error.code)) setBlocked(true);
    } finally { setBusy(false); }
  });
  if (status === "loading" || status === "unauthenticated" || status === "authenticated") return <p role="status" className="text-sm text-muted">Checking your session...</p>;
  const expired = !session || Date.parse(session.refreshExpiresAt) <= openedAt;
  return <form onSubmit={submit} noValidate className="ui-panel w-full max-w-sm ui-stack p-form-panel">
    <div><h1 className="text-xl font-semibold">Unlock your account</h1>
      <p className="mt-tight text-sm text-muted break-words">Welcome back, {session?.user.name}.</p></div>
    {expired ? <p role="alert" className="text-sm text-danger">Your device session has expired. Sign in with your password.</p> :
      <Field label="4-digit PIN" required error={form.formState.errors.pin?.message}>
        {(props) => <input {...props} {...form.register("pin")} type="password" inputMode="numeric" pattern="[0-9]{4}" maxLength={4} autoComplete="off" autoFocus disabled={busy || blocked} className={`${props.className} text-center text-2xl tracking-widest`} />}
      </Field>}
    <Button type="submit" disabled={busy || blocked || expired}>{busy ? "Unlocking..." : "Unlock"}</Button>
    <p className="text-sm text-muted">Forgot your PIN? You can always sign in with your password.</p>
    <Button type="button" variant="ghost" disabled={busy} onClick={async () => {
      setBusy(true);
      // Remove cached shop data before opening a full password login.
      await cache.cancelQueries(); cache.clear();
      const logout = apiRequest("/auth/logout", { method: "POST", body: { refreshToken: session?.refreshToken }, anonymous: true }).catch(() => undefined);
      clearSession(); router.replace("/login");
      await logout;
    }}>Use password instead</Button>
  </form>;
}
