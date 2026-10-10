"use client";

import Link from "next/link";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { Button, Field } from "@/components/ui/field.tsx";
import { apiRequest, ApiClientError } from "@/lib/client/api.ts";
import { forgotPasswordSchema, RESET_REQUEST_MESSAGE } from "@/lib/auth/password-reset-schema.ts";
import { zodResolver } from "@/lib/forms/zod-resolver.ts";

export default function ForgotPasswordPage() {
  const [sent, setSent] = useState(false);
  const [error, setError] = useState("");
  const form = useForm<{ email: string }>({ resolver: zodResolver(forgotPasswordSchema), defaultValues: { email: "" } });
  const submit = form.handleSubmit(async (values) => {
    setError(""); setSent(false);
    try {
      await apiRequest("/auth/forgot-password", { method: "POST", anonymous: true, body: values });
      setSent(true);
    } catch (e) { setError(e instanceof ApiClientError ? e.message : "Could not send the request. Please try again."); }
  });
  return <div className="flex flex-1 items-center justify-center p-content">
    <form onSubmit={submit} className="ui-panel flex w-full max-w-sm flex-col gap-content p-form-panel">
      <div><h1 className="text-xl font-semibold">Forgot password</h1><p className="mt-tight text-sm text-muted">Enter your account email to request a reset link.</p></div>
      <Field label="Email" required error={form.formState.errors.email?.message}>{(props) => <input {...props} type="email" inputMode="email" autoComplete="email" {...form.register("email")} />}</Field>
      {sent && <p role="status" className="text-sm text-muted">{RESET_REQUEST_MESSAGE}</p>}
      {error && <p role="alert" className="text-sm text-danger">{error}</p>}
      <Button type="submit" disabled={form.formState.isSubmitting}>{form.formState.isSubmitting ? "Sending…" : "Send reset link"}</Button>
      <Link href="/login" className="inline-flex min-h-11 items-center justify-center text-sm text-primary underline">Back to sign in</Link>
    </form>
  </div>;
}
