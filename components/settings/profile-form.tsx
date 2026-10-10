"use client";

import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { ApiClientError, apiRequest } from "@/lib/client/api.ts";
import { useSession } from "@/lib/client/use-session.ts";
import { updateSessionUser } from "@/lib/client/session.ts";
import { CURRENT_TENANT_QUERY_KEY, type CurrentTenantResponse } from "@/lib/client/current-tenant.ts";
import { profileDetailsSchema, type ProfilePatch, type ProfileResponse } from "@/lib/profile/schema.ts";
import { zodResolver } from "@/lib/forms/zod-resolver.ts";
import { Button, Field, FormSection } from "@/components/ui/field.tsx";
import { ImageUploadField } from "@/components/ui/image-upload.tsx";
import { EmailVerification } from "@/components/auth/email-verification.tsx";

const PROFILE_QUERY_KEY = ["profile"] as const;
type Details = { name: string; email: string };

export function ProfileForm() {
  const { status, session } = useSession();
  const cache = useQueryClient();
  const [uploading, setUploading] = useState(false);
  const profile = useQuery({ queryKey: PROFILE_QUERY_KEY, enabled: status === "authenticated",
    queryFn: ({ signal }) => apiRequest<ProfileResponse>("/profile", { signal }) });
  const form = useForm<Details>({ resolver: zodResolver<Details>(profileDetailsSchema), mode: "onBlur" });
  const { reset, formState: { dirtyFields } } = form;
  const user = profile.data?.user;
  useEffect(() => {
    if (!user) return;
    reset({ name: user.name, email: user.email }, { keepDirtyValues: true, keepDirty: true });
    updateSessionUser(user);
  }, [user, reset]);

  const save = useMutation({
    onMutate: async () => {
      await Promise.all([
        cache.cancelQueries({ queryKey: PROFILE_QUERY_KEY }),
        cache.cancelQueries({ queryKey: CURRENT_TENANT_QUERY_KEY }),
      ]);
    },
    mutationFn: (patch: ProfilePatch) => apiRequest<ProfileResponse>("/profile", { method: "PATCH", body: patch }),
    onSuccess: (result, patch) => {
      updateSessionUser(result.user);
      cache.setQueryData(PROFILE_QUERY_KEY, result);
      cache.setQueryData<CurrentTenantResponse>(CURRENT_TENANT_QUERY_KEY, (current) => current ? {
        ...current, viewer: { ...current.viewer, name: result.user.name, email: result.user.email, photoUrl: result.user.photoUrl ?? null },
      } : current);
      if (patch.name !== undefined || patch.email !== undefined) reset({ name: result.user.name, email: result.user.email });
      void cache.invalidateQueries({ queryKey: CURRENT_TENANT_QUERY_KEY });
      void cache.invalidateQueries({ queryKey: ["people", "users"] });
    },
    onError: (error) => {
      if (error instanceof ApiClientError && error.details) {
        for (const key of ["name", "email"] as const) {
          const message = error.details[key]?.[0];
          if (message) form.setError(key, { type: "server", message });
        }
      }
    },
  });

  const submit = form.handleSubmit((values) => {
    const patch: ProfilePatch = {};
    if (dirtyFields.name) patch.name = values.name;
    if (dirtyFields.email) patch.email = values.email;
    if (!Object.keys(patch).length) { toast.info("No profile changes to save."); return; }
    toast.promise(save.mutateAsync(patch), { loading: "Saving profile...", success: (result) => result.user.pendingEmail ? "Profile saved. Verify your new email to change your sign-in email." : "Profile saved.", error: (error) => error instanceof Error ? error.message : "Could not save profile." });
  });

  if (profile.isPending) return <div className="ui-panel text-sm text-muted" role="status">Loading profile...</div>;
  if (profile.isError) return <div className="ui-panel ui-stack" role="alert"><p className="text-sm text-danger">Could not load your profile.</p><Button variant="ghost" onClick={() => void profile.refetch()}>Try again</Button></div>;
  if (!user) return null;
  const busy = uploading || save.isPending;
  return (
    <div className="ui-stack">
      <EmailVerification compact />
      <FormSection title="Profile photo" description="Your photo appears in the account menu. Uploads are saved automatically.">
        <ImageUploadField label="Profile photo" purpose="profile" allowUrl={false} value={user.photoUrl ?? ""}
          disabled={save.isPending} onUploadingChange={setUploading}
          onChange={async (url) => {
            await save.mutateAsync({ photoUrl: url || null });
            toast.success(url ? "Profile photo saved." : "Profile photo removed.");
          }} />
      </FormSection>
      <form onSubmit={submit} noValidate className="ui-stack">
        <FormSection title="Personal details" description="Keep your name and sign-in email up to date.">
          <Field label="Name" required error={form.formState.errors.name?.message}>
            {(props) => <input {...props} {...form.register("name")} autoComplete="name" maxLength={120} disabled={busy} />}
          </Field>
          <Field label="Email" required error={form.formState.errors.email?.message} hint="Your current sign-in email stays active until you verify the new address.">
            {(props) => <input {...props} {...form.register("email")} type="email" autoComplete="email" maxLength={254} disabled={busy} />}
          </Field>
          <div className="sm:col-span-2 text-sm text-muted">
            <span className="font-medium text-foreground">Role: </span>
            <span className="capitalize">{(session?.user.role ?? user.role).replace(/_/g, " ")}</span>
          </div>
        </FormSection>
        <div className="ui-toolbar"><Button type="submit" disabled={busy}>{save.isPending ? "Saving..." : "Save profile"}</Button></div>
      </form>
    </div>
  );
}
