"use client";

import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { toast } from "sonner";
import { ApiClientError, apiRequest } from "@/lib/client/api.ts";
import { useSession } from "@/lib/client/use-session.ts";
import { CURRENT_TENANT_QUERY_KEY } from "@/lib/client/current-tenant.ts";
import { useDebouncedValue } from "@/lib/client/use-debounced-value.ts";
import { zodResolver } from "@/lib/forms/zod-resolver.ts";
import { staffCreateSchema, type StaffList, type StaffRole, type StaffUser } from "@/lib/people/users.ts";
import { Button, Field } from "@/components/ui/field.tsx";
import { Badge, EmptyState, ErrorState, ListSkeleton, Pager, SearchInput } from "@/components/ui/list-controls.tsx";
import { ConfirmSheet, Sheet } from "@/components/ui/sheet.tsx";

const USERS_KEY = ["people", "users"] as const;
const PAGE_SIZE = 20;

export function UsersManager() {
  const { session } = useSession();
  const owner = session?.user.role === "shop_owner";
  const cache = useQueryClient();
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("all");
  const [role, setRole] = useState("all");
  const [page, setPage] = useState(1);
  const [target, setTarget] = useState<StaffUser | "new" | null>(null);
  const [confirm, setConfirm] = useState<StaffUser | null>(null);
  const term = useDebouncedValue(search.trim(), 300);
  const list = useQuery({ queryKey: [...USERS_KEY, { term, status, role, page }], enabled: owner,
    queryFn: ({ signal }) => apiRequest<StaffList>(`/users?${new URLSearchParams({ search: term, status, role, page: String(page), pageSize: String(PAGE_SIZE) })}`, { signal }),
    placeholderData: keepPreviousData });
  async function refresh() {
    await Promise.all([cache.invalidateQueries({ queryKey: USERS_KEY }), cache.invalidateQueries({ queryKey: CURRENT_TENANT_QUERY_KEY })]);
  }
  const active = useMutation({
    mutationFn: (user: StaffUser) => apiRequest(`/users/${user.id}`, { method: "PATCH", body: { isActive: !user.isActive } }),
    onSuccess: async () => { setConfirm(null); await refresh(); },
  });
  if (!owner) return <p role="alert" className="ui-panel text-danger">Only the shop owner can manage users.</p>;
  return <div className="ui-stack">
    <div className="ui-panel flex flex-wrap items-center justify-between gap-item">
      <div className="min-w-0"><p className="truncate text-sm font-medium" title={list.data?.shop.name}>{list.data?.shop.name ?? "Your shop"}</p>
        <p className="mt-tight text-xs text-muted">{list.data ? `${list.data.usage.active} / ${list.data.usage.max} active staff accounts` : "Loading staff usage..."}</p></div>
      <Button type="button" onClick={() => setTarget("new")}>Add user</Button>
    </div>
    <div className="ui-field-grid sm:grid-cols-3">
      <SearchInput value={search} onChange={(value) => { setSearch(value); setPage(1); }} label="Search name or email" />
      <Field label="Status">{(props) => <select {...props} value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }}><option value="all">All statuses</option><option value="active">Active</option><option value="inactive">Inactive</option></select>}</Field>
      <Field label="Role">{(props) => <select {...props} value={role} onChange={(e) => { setRole(e.target.value); setPage(1); }}><option value="all">All roles</option><option value="staff">Staff</option><option value="manager">Manager</option></select>}</Field>
    </div>
    {list.isPending && <ListSkeleton label="Loading users" />}
    {list.isError && <ErrorState message={list.error.message} onRetry={() => void list.refetch()} />}
    {list.data && <>
      {list.data.users.length === 0 ? <EmptyState>No users match these filters.</EmptyState> : <div className="ui-card-grid md:grid-cols-2 xl:grid-cols-3">{list.data.users.map((user) => <article key={user.id} className="ui-panel min-w-0">
        <div className="flex items-start justify-between gap-small"><h2 className="min-w-0 break-words text-sm font-semibold">{user.name}</h2><Badge>{user.isActive ? "Active" : "Inactive"}</Badge></div>
        <p className="mt-small break-words text-sm text-muted">{user.email}</p><p className="mt-tight text-xs capitalize text-muted">{user.role} / {list.data.shop.name}</p>
        <div className="mt-content flex flex-wrap gap-small"><Button variant="ghost" aria-label={`Edit ${user.name}`} onClick={() => setTarget(user)}>Edit</Button><Button variant="ghost" disabled={active.isPending || list.isPlaceholderData} onClick={() => setConfirm(user)} aria-label={`${user.isActive ? "Deactivate" : "Reactivate"} ${user.name}`}>{user.isActive ? "Deactivate" : "Reactivate"}</Button></div>
      </article>)}</div>}
      <Pager page={page} pageSize={PAGE_SIZE} total={list.data.total} onPageChange={setPage} busy={list.isFetching} />
    </>}
    <Sheet open={target !== null} onOpenChange={(open) => { if (!open) setTarget(null); }} title={target === "new" ? "Add user" : "Edit user"} description="Accounts are assigned to your shop automatically.">
      {target && <UserForm key={target === "new" ? "new" : target.id} user={target === "new" ? null : target} shop={list.data?.shop.name ?? "Your shop"} done={async () => { setTarget(null); await refresh(); }} />}
    </Sheet>
    <ConfirmSheet open={confirm !== null} onOpenChange={(open) => { if (!open && !active.isPending) setConfirm(null); }} title={confirm?.isActive ? "Deactivate user?" : "Reactivate user?"}
      description={confirm?.isActive ? "This user will lose access and all their sessions will be signed out. Their sales and activity history will stay intact." : "This user can sign in again. An available staff slot is required; old sessions remain signed out."}
      confirmLabel={confirm?.isActive ? "Deactivate" : "Reactivate"} pending={active.isPending} onConfirm={() => { if (confirm) toast.promise(active.mutateAsync(confirm), { loading: "Updating access...", success: "User access updated.", error: (error) => error instanceof Error ? error.message : "Could not update access." }); }} />
  </div>;
}

type Values = { name: string; email: string; role: StaffRole; isActive: boolean; password: string };
function UserForm({ user, shop, done }: { user: StaffUser | null; shop: string; done: () => Promise<void> }) {
  const schema = user ? staffCreateSchema.omit({ password: true }).extend({ password: z.literal("") }) : staffCreateSchema;
  const form = useForm<Values>({ resolver: zodResolver<Values>(schema), defaultValues: { name: user?.name ?? "", email: user?.email ?? "", role: user?.role ?? "staff", isActive: user?.isActive ?? true, password: "" } });
  const { errors, dirtyFields } = form.formState;
  const save = useMutation({
    mutationFn: (values: Values) => {
      const body = user ? Object.fromEntries(Object.keys(dirtyFields).filter((key) => key !== "password").map((key) => [key, values[key as keyof Values]])) : values;
      return apiRequest<{ user: StaffUser }>(user ? `/users/${user.id}` : "/users", { method: user ? "PATCH" : "POST", body });
    },
    onSuccess: done,
    onError: (error) => { if (error instanceof ApiClientError && error.details) for (const [key, messages] of Object.entries(error.details)) if (key in form.getValues()) form.setError(key as keyof Values, { message: messages[0] }); },
  });
  return <form className="ui-stack" onSubmit={form.handleSubmit((values) => {
    if (user && !Object.keys(dirtyFields).length) return;
    toast.promise(save.mutateAsync(values), { loading: "Saving user...", success: user ? "User updated." : "User created.", error: (error) => error instanceof Error ? error.message : "Could not save user." });
  })}>
    <fieldset disabled={save.isPending} className="ui-stack min-w-0">
      <Field label="Name" required error={errors.name?.message}>{(props) => <input {...props} autoComplete="off" {...form.register("name")} />}</Field>
      <Field label="Email" required error={errors.email?.message}>{(props) => <input {...props} type="email" autoComplete="off" {...form.register("email")} />}</Field>
      {!user && <Field label="Initial password" required error={errors.password?.message} hint="Share this password with the user so they can sign in.">{(props) => <input {...props} type="password" autoComplete="new-password" {...form.register("password")} />}</Field>}
      <Field label="Role" error={errors.role?.message} hint={user ? "Changing the role signs out all existing sessions." : undefined}>{(props) => <select {...props} {...form.register("role")}><option value="staff">Staff</option><option value="manager">Manager</option></select>}</Field>
      <Field label="Assigned shop">{(props) => <input {...props} value={shop} readOnly />}</Field>
      <Field label="Status" error={errors.isActive?.message}>{(props) => <select {...props} {...form.register("isActive", { setValueAs: (value) => value === true || value === "true" })}><option value="true">Active</option><option value="false">Inactive</option></select>}</Field>
      {save.isError && <p role="alert" className="text-sm text-danger">{save.error.message}</p>}
      <Button type="submit" disabled={save.isPending || (!!user && !Object.keys(dirtyFields).length)}>{save.isPending ? "Saving..." : user ? "Save user" : "Create user"}</Button>
    </fieldset>
  </form>;
}
