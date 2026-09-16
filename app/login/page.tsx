"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { ApiClientError } from "@/lib/client/api.ts";
import { useSignIn } from "@/lib/client/use-session.ts";
import { zodResolver } from "@/lib/forms/zod-resolver.ts";
import { loginSchema } from "@/lib/auth/schemas.ts";
import { Button, Field } from "@/components/ui/field.tsx";

/**
 * Sign-in screen.
 *
 * Scoped to exactly what the Business Settings step needs: `proxy.ts` bounces
 * an unauthenticated visitor from `/settings/*` to `/login`, so without this
 * page the settings screen is unreachable in a browser. Signup, email
 * verification, forgot-password and PIN unlock are separate screens against
 * endpoints that already exist — they are not part of this step.
 */

interface LoginFormValues {
  email: string;
  password: string;
}

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const signIn = useSignIn();
  const [submitting, setSubmitting] = useState(false);

  const form = useForm<LoginFormValues>({
    resolver: zodResolver<LoginFormValues>(loginSchema),
    defaultValues: { email: "", password: "" },
  });

  const onSubmit = form.handleSubmit(async (values) => {
    setSubmitting(true);
    try {
      const payload = await signIn(values);

      // A super_admin has no shop of their own, so the tenant settings screen
      // is not theirs to open — the platform panel is a separate area.
      const next = searchParams.get("next");
      const destination =
        payload.user.role === "super_admin"
          ? "/admin"
          : (next?.startsWith("/") ? next : "/dashboard");

      toast.success(`Welcome back, ${payload.user.name}.`);
      router.replace(destination);
    } catch (error) {
      const message =
        error instanceof ApiClientError
          ? error.message
          : "Could not sign in. Please try again.";
      toast.error(message);
      // The server deliberately does not say which half was wrong, so the
      // error goes on the form rather than on one field.
      form.setError("password", { type: "server", message });
    } finally {
      setSubmitting(false);
    }
  });

  return (
    <form
      onSubmit={onSubmit}
      className="flex w-full max-w-sm flex-col gap-4 rounded-xl border border-zinc-200 bg-white p-6 shadow-sm dark:border-zinc-800 dark:bg-zinc-900"
    >
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Sign in</h1>
        <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
          Use your shop account.
        </p>
      </div>

      <Field label="Email" error={form.formState.errors.email?.message} required>
        {(props) => (
          <input
            {...props}
            type="email"
            inputMode="email"
            autoComplete="email"
            autoFocus
            {...form.register("email")}
          />
        )}
      </Field>

      <Field
        label="Password"
        error={form.formState.errors.password?.message}
        required
      >
        {(props) => (
          <input
            {...props}
            type="password"
            autoComplete="current-password"
            {...form.register("password")}
          />
        )}
      </Field>

      <Button type="submit" disabled={submitting}>
        {submitting ? "Signing in…" : "Sign in"}
      </Button>
    </form>
  );
}

export default function LoginPage() {
  return (
    <div className="flex flex-1 items-center justify-center p-4">
      {/* `useSearchParams` opts the subtree into client-side rendering, so it
          needs a Suspense boundary or the whole route deopts. */}
      <Suspense fallback={null}>
        <LoginForm />
      </Suspense>
    </div>
  );
}
