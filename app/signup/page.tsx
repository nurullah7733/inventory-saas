"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { signupSchema } from "@/lib/auth/schemas.ts";
import { ApiClientError } from "@/lib/client/api.ts";
import { useSignUp } from "@/lib/client/use-session.ts";
import { zodResolver } from "@/lib/forms/zod-resolver.ts";
import { Button, Field } from "@/components/ui/field.tsx";

const formSchema = signupSchema.extend({ confirmPassword: signupSchema.shape.password })
  .refine((value) => value.password === value.confirmPassword, {
    path: ["confirmPassword"], message: "Passwords must match.",
  });
interface SignupFormValues {
  businessName: string; name: string; email: string; phone: string;
  password: string; confirmPassword: string;
}

export default function SignupPage() {
  const router = useRouter();
  const signUp = useSignUp();
  const form = useForm<SignupFormValues>({
    resolver: zodResolver<SignupFormValues>(formSchema),
    defaultValues: { businessName: "", name: "", email: "", phone: "", password: "", confirmPassword: "" },
  });
  const onSubmit = form.handleSubmit(async (values) => {
    form.clearErrors("root");
    try {
      await signUp({ businessName: values.businessName, name: values.name,
        email: values.email, phone: values.phone.trim() || undefined, password: values.password });
      toast.success("Your shop account is ready. Welcome!");
      router.replace("/dashboard");
    } catch (error) {
      const message = error instanceof ApiClientError ? error.message : "Could not create your account. Please try again.";
      if (error instanceof ApiClientError && error.code === "EMAIL_TAKEN") {
        form.setError("email", { type: "server", message }, { shouldFocus: true });
      } else {
        form.setError("root.server", { type: "server", message });
      }
      toast.error(message);
    }
  });
  return <div className="flex flex-1 items-center justify-center p-4">
    <form onSubmit={onSubmit} className="flex w-full max-w-md flex-col gap-4 rounded-xl border border-zinc-200 bg-white p-6 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Create your shop account</h1>
        <p className="mt-1 text-sm text-zinc-500">Start a 14-day trial. You will be the owner of your new shop.</p>
      </div>
      <fieldset disabled={form.formState.isSubmitting} className="flex min-w-0 flex-col gap-4">
        <Field label="Shop name" required error={form.formState.errors.businessName?.message}>{(props) =>
          <input {...props} autoComplete="organization" maxLength={160} {...form.register("businessName")} />}</Field>
        <Field label="Your name" required error={form.formState.errors.name?.message}>{(props) =>
          <input {...props} autoComplete="name" maxLength={120} {...form.register("name")} />}</Field>
        <Field label="Email" required error={form.formState.errors.email?.message}>{(props) =>
          <input {...props} type="email" autoComplete="email" maxLength={254} {...form.register("email")} />}</Field>
        <Field label="Phone (optional)" error={form.formState.errors.phone?.message}>{(props) =>
          <input {...props} type="tel" autoComplete="tel" maxLength={32} {...form.register("phone")} />}</Field>
        <Field label="Password" required error={form.formState.errors.password?.message}>{(props) =>
          <input {...props} type="password" autoComplete="new-password" minLength={8} maxLength={72} {...form.register("password")} />}</Field>
        <p className="-mt-2 text-xs text-zinc-500">Use 8–72 characters.</p>
        <Field label="Confirm password" required error={form.formState.errors.confirmPassword?.message}>{(props) =>
          <input {...props} type="password" autoComplete="new-password" minLength={8} maxLength={72} {...form.register("confirmPassword")} />}</Field>
        {form.formState.errors.root?.server && <p role="alert" className="text-sm text-red-600">{form.formState.errors.root.server.message}</p>}
        <Button type="submit">{form.formState.isSubmitting ? "Creating account…" : "Create account"}</Button>
      </fieldset>
      <p className="text-center text-sm text-zinc-500">Already have an account? <Link href="/login" className="inline-flex min-h-11 items-center font-medium text-emerald-700 underline dark:text-emerald-400">Sign in</Link></p>
    </form>
  </div>;
}
