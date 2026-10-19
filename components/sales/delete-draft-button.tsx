"use client";

import { useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { apiRequest } from "@/lib/client/api.ts";
import { Button } from "@/components/ui/field.tsx";
import { ConfirmSheet } from "@/components/ui/sheet.tsx";

export function DeleteDraftButton({ id, invoiceNo, onDeleted }: {
  id: string; invoiceNo: string; onDeleted?: () => void;
}) {
  const client = useQueryClient();
  const [open, setOpen] = useState(false);
  const submitting = useRef(false);
  const mutation = useMutation({
    mutationFn: () => apiRequest(`/invoices/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      setOpen(false);
      onDeleted?.();
      client.removeQueries({ queryKey: ["sales", "invoice", id], exact: true });
      void client.invalidateQueries({ queryKey: ["sales", "invoices"] });
    },
  });
  async function confirm() {
    if (submitting.current) return;
    submitting.current = true;
    try {
      await mutation.mutateAsync();
      toast.success("Draft invoice deleted.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not delete draft invoice.");
    } finally { submitting.current = false; }
  }
  return <>
    <Button type="button" variant="ghost" disabled={mutation.isPending} onClick={() => setOpen(true)} aria-label={`Delete draft ${invoiceNo}`}>Delete draft</Button>
    <ConfirmSheet open={open} onOpenChange={(next) => { if (!mutation.isPending) setOpen(next); }}
      title="Delete draft invoice?" description={`Delete ${invoiceNo} and its items permanently? Stock will remain unchanged.`}
      confirmLabel="Delete draft" pending={mutation.isPending} onConfirm={() => void confirm()} />
  </>;
}
