"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useForm, useWatch } from "react-hook-form";
import { useQueryClient } from "@tanstack/react-query";
import { Button, Field } from "@/components/ui/field.tsx";
import { apiRequest, ApiClientError } from "@/lib/client/api.ts";
import { clearSession } from "@/lib/client/session.ts";
import { resetPasswordFormSchema } from "@/lib/auth/password-reset-schema.ts";
import { zodResolver } from "@/lib/forms/zod-resolver.ts";

const LINK_KEY = "inventory-saas.password-reset-link";
type Values = { token: string; newPassword: string; confirmPassword: string };

export default function ResetPasswordPage() {
  const cache = useQueryClient();
  const [ready, setReady] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState("");
  const form = useForm<Values>({ resolver: zodResolver(resetPasswordFormSchema), defaultValues: { token: "", newPassword: "", confirmPassword: "" } });
  const { setValue } = form;
  useEffect(() => {
    const capture = () => {
      let token = new URLSearchParams(window.location.hash.slice(1)).get("token") ?? "";
      try {
        if (/^[a-f0-9]{64}$/.test(token)) sessionStorage.setItem(LINK_KEY, JSON.stringify({ token, receivedAt: Date.now() }));
        else if (!window.location.hash) {
          const stored = JSON.parse(sessionStorage.getItem(LINK_KEY) ?? "null");
          if (stored && Date.now() - stored.receivedAt < 30 * 60 * 1000) token = stored.token;
        }
      } catch { /* The original fragment remains usable without browser storage. */ }
      if (window.location.hash) history.replaceState(history.state, "", window.location.pathname);
      setValue("token", /^[a-f0-9]{64}$/.test(token) ? token : "");
      setReady(true);
    };
    const frame = requestAnimationFrame(capture);
    window.addEventListener("hashchange", capture);
    return () => { cancelAnimationFrame(frame); window.removeEventListener("hashchange", capture); };
  }, [setValue]);
  const token = useWatch({ control: form.control, name: "token" });
  const submit = form.handleSubmit(async ({ token, newPassword }) => {
    setError("");
    try {
      await apiRequest("/auth/reset-password", { method: "POST", anonymous: true, body: { token, newPassword } });
      clearSession(); await cache.cancelQueries(); cache.clear();
      try { sessionStorage.removeItem(LINK_KEY); } catch { /* Storage may be disabled. */ }
      form.reset(); setDone(true);
    } catch (e) { setError(e instanceof ApiClientError ? e.message : "Could not reset your password. Please try again."); }
  });
  return <div className="flex flex-1 items-center justify-center p-content">
    <form onSubmit={submit} className="ui-panel flex w-full max-w-sm flex-col gap-content p-form-panel">
      <div><h1 className="text-xl font-semibold">Reset password</h1><p className="mt-tight text-sm text-muted">Choose a new password for your account.</p></div>
      {done ? <><p role="status" className="text-sm text-muted">Your password has been reset. All previous sessions have been signed out.</p><Link href="/login" className="inline-flex min-h-11 items-center justify-center text-sm text-primary underline">Sign in with your new password</Link></> : <>
        {ready && !token ? <p role="alert" className="text-sm text-danger">This reset link is missing or invalid. Request a new link.</p> : <>
          <Field label="New password" required hint="Use 8–72 characters (maximum 72 bytes)." error={form.formState.errors.newPassword?.message}>{(props) => <input {...props} type="password" autoComplete="new-password" {...form.register("newPassword")} />}</Field>
          <Field label="Confirm password" required error={form.formState.errors.confirmPassword?.message}>{(props) => <input {...props} type="password" autoComplete="new-password" {...form.register("confirmPassword")} />}</Field>
          <Button type="submit" disabled={!ready || !token || form.formState.isSubmitting}>{form.formState.isSubmitting ? "Resetting…" : "Reset password"}</Button>
        </>}
        {error && <p role="alert" className="text-sm text-danger">{error}</p>}
        <Link href="/forgot-password" className="inline-flex min-h-11 items-center justify-center text-sm text-primary underline">Request a new reset link</Link>
      </>}
    </form>
  </div>;
}
