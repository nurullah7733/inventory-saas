"use client";

import { useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { apiRequest } from "@/lib/client/api.ts";
import { useCurrencySymbol } from "@/lib/client/current-tenant.ts";
import { currentCommissionMonth } from "@/lib/commissions/calculations.ts";
import type { CommissionReport, CommissionRow } from "@/lib/commissions/types.ts";
import { Button, Field } from "@/components/ui/field.tsx";
import { ErrorState, ListSkeleton } from "@/components/ui/list-controls.tsx";

function formatQty(value: string): string {
  return value.includes(".") ? value.replace(/\.?0+$/, "") : value;
}

export function CommissionsManager() {
  const [month, setMonth] = useState(() => currentCommissionMonth());
  const [userId, setUserId] = useState("");
  const [page, setPage] = useState(1);
  const currency = useCurrencySymbol();
  const validMonth = /^20\d{2}-(0[1-9]|1[0-2])$/.test(month);
  const query = useQuery({
    queryKey: ["commissions", month, userId, page], enabled: validMonth,
    queryFn: ({ signal }) => apiRequest<CommissionReport>(`/commissions?month=${month}&page=${page}${userId ? `&userId=${userId}` : ""}`, { signal }),
  });
  const report = query.data;
  return <div className="ui-stack">
    <div><h1 className="text-xl font-semibold">Sales &amp; commission</h1>
      <p className="mt-tight text-sm text-muted">Monthly commission = sales above target × rate. Months follow Bangladesh time.</p></div>
    <div className="ui-field-grid sm:grid-cols-2">
      <Field label="Month">{(props) => <input {...props} type="month" min="2000-01" max="2099-12" value={month} onChange={(event) => { setMonth(event.target.value); setPage(1); }} />}</Field>
      {userId && report?.canManage && <Button variant="ghost" onClick={() => { setUserId(""); setPage(1); }}>All team members</Button>}
    </div>
    <p className="text-sm text-muted">Qualifying sales count the full invoice goods value, excluding VAT, discounts and returns. Paid or unpaid (credit) does not matter. Sale credit belongs to the account that completes the invoice. Base salary is separate.</p>
    {!validMonth ? <p>Select a month.</p> : query.isPending ? <ListSkeleton label="Loading sales and commission" /> : query.isError ? <ErrorState message={query.error.message} onRetry={() => void query.refetch()} /> : report && <>
      {report.canManage && <p className="text-sm text-muted">Set a plan for each staff member or manager each month. Plans lock when the month ends; payments can then be recorded. Later returns reduce earnings and overpayments reduce future available commission.</p>}
      <div className="ui-card-grid xl:grid-cols-2">{report.rows.map((row) => <section className="ui-panel ui-stack" key={`${month}:${row.userId}`}>
        <div><h2 className="font-semibold">{row.name}</h2><p className="text-sm capitalize text-muted">{row.role.replaceAll("_", " ")}{!row.isActive && " · Inactive"}</p></div>
        <dl className="ui-field-grid sm:grid-cols-2">{[
          ["Completed invoices", row.invoiceCount], ["Sold quantity", formatQty(row.soldQuantity)], ["Returned quantity", formatQty(row.returnedQuantity)],
          ["Qualifying sales", `${currency} ${row.eligibleSales}`], ["Monthly target", `${currency} ${row.target}`],
          ["Rate", row.enabled ? `${row.rate}%` : "Not enabled"], ["Commission earned", `${currency} ${row.earned}`],
          ["Payments recorded", `${currency} ${row.paid}`], ["Month balance", `${currency} ${row.outstanding}`],
        ].map(([label, value]) => <div key={label}><dt className="text-sm text-muted">{label}</dt><dd className="font-semibold">{value}</dd></div>)}</dl>
        {Number(row.overpaid) > 0 && <p role="status" className="text-sm text-danger">Overpaid after returns: {currency} {row.overpaid}. This reduces future available commission.</p>}
        {report.canManage && !userId && <Button variant="ghost" onClick={() => { setUserId(row.userId); setPage(1); }}>View products &amp; manage commission</Button>}
        {report.canManage && userId && ["staff", "manager"].includes(row.role) && <>
          {report.policyEditable ? <PolicyForm month={month} row={row} /> : <p className="text-sm text-muted">This month&apos;s target and rate are locked.</p>}
          {!report.policyEditable && Number(report.availableToPay) > 0 && <PaymentForm month={month} row={row} currency={currency} available={report.availableToPay!} />}
        </>}
      </section>)}</div>
      {(userId || !report.canManage) && <section className="ui-panel ui-stack">
        <h2 className="font-semibold">Products sold</h2>
        {report.availableToPay !== null && <p className="text-sm">Available commission after adjustments: {currency} {report.availableToPay}</p>}
        {report.products.length ? <div className="overflow-x-auto"><table className="w-full text-left text-sm"><thead><tr><th className="p-small">Product / variant</th><th className="p-small">Sold</th><th className="p-small">Returned</th></tr></thead>
          <tbody>{report.products.map((product, index) => <tr className="border-t border-border" key={`${product.productId}:${index}`}><td className="p-small">{product.name}<span className="block text-xs text-muted">{product.variant}</span></td><td className="p-small">{formatQty(product.quantity)}</td><td className="p-small">{formatQty(product.returned)}</td></tr>)}</tbody></table></div> : <p className="text-sm text-muted">No completed sales for this month.</p>}
        {report.productTotal > 50 && <div className="flex items-center justify-between gap-item"><Button variant="ghost" disabled={page === 1} onClick={() => setPage(page - 1)}>Previous</Button><span>Page {page} of {Math.ceil(report.productTotal / 50)}</span><Button variant="ghost" disabled={page * 50 >= report.productTotal} onClick={() => setPage(page + 1)}>Next</Button></div>}
      </section>}
      <section className="ui-panel ui-stack"><h2 className="font-semibold">Recent commission payments</h2>
        <p className="text-sm text-muted">These records are separate from base salary and the Expenses ledger. Recording a payment does not transfer money.</p>
        {report.payments.length ? <ul className="ui-stack">{report.payments.map((payment) => <li key={payment.id} className="border-b border-border pb-small"><span className="font-medium">{report.rows.find((row) => row.userId === payment.userId)?.name}: {currency} {payment.amount}</span><p className="text-xs text-muted">{new Date(payment.createdAt).toLocaleString("en-GB", { timeZone: "Asia/Dhaka" })}{payment.note ? ` · ${payment.note}` : ""}</p></li>)}</ul> : <p className="text-sm text-muted">No payments recorded.</p>}
      </section>
    </>}
  </div>;
}

function PolicyForm({ month, row }: { month: string; row: CommissionRow }) {
  const cache = useQueryClient();
  const [enabled, setEnabled] = useState(row.enabled);
  const [target, setTarget] = useState(row.target);
  const [rate, setRate] = useState(row.rate);
  const mutation = useMutation({
    mutationFn: () => apiRequest("/commissions", { method: "PUT", body: { month, userId: row.userId, enabled, target, rate } }),
    onSuccess: async () => { await cache.invalidateQueries({ queryKey: ["commissions"] }); toast.success("Monthly plan saved."); },
  });
  return <form className="ui-stack border-t border-border pt-content" onSubmit={(event) => { event.preventDefault(); mutation.mutate(); }}>
    <h3 className="font-medium">Monthly commission plan</h3>
    <label className="flex items-center gap-small text-sm"><input type="checkbox" checked={enabled} disabled={mutation.isPending} onChange={(event) => setEnabled(event.target.checked)} />Enable commission</label>
    <div className="ui-field-grid sm:grid-cols-2">
      <Field label="Sales target">{(props) => <input {...props} required type="number" min="0" max="99999999.99" step="0.01" value={target} disabled={mutation.isPending} onChange={(event) => setTarget(event.target.value)} />}</Field>
      <Field label="Commission rate (%)">{(props) => <input {...props} required type="number" min="0" max="100" step="0.01" value={rate} disabled={mutation.isPending} onChange={(event) => setRate(event.target.value)} />}</Field>
    </div>
    {mutation.isError && <p role="alert" className="text-sm text-danger">{mutation.error.message}</p>}
    <Button type="submit" disabled={mutation.isPending}>{mutation.isPending ? "Saving..." : "Save monthly plan"}</Button>
  </form>;
}

function PaymentForm({ month, row, currency, available }: { month: string; row: CommissionRow; currency: string; available: string }) {
  const cache = useQueryClient();
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const request = useRef<{ key: string; id: string } | null>(null);
  const mutation = useMutation({
    mutationFn: () => {
      const key = JSON.stringify({ month, userId: row.userId, amount, note });
      if (request.current?.key !== key) request.current = { key, id: crypto.randomUUID() };
      return apiRequest("/commissions/payments", { method: "POST", body: { requestId: request.current.id, month, userId: row.userId, amount, note } });
    },
    onSuccess: async () => { request.current = null; setAmount(""); setNote(""); setConfirmed(false); await cache.invalidateQueries({ queryKey: ["commissions"] }); toast.success("Commission payment recorded."); },
  });
  return <form className="ui-stack border-t border-border pt-content" onSubmit={(event) => { event.preventDefault(); if (confirmed) mutation.mutate(); }}>
    <h3 className="font-medium">Record commission paid</h3>
    <p className="text-sm text-muted">Available after earlier payments and returns: {currency} {available}.</p>
    <Field label="Amount paid">{(props) => <input {...props} required type="number" min="0.01" max={available} step="0.01" value={amount} disabled={mutation.isPending} onChange={(event) => { setAmount(event.target.value); setConfirmed(false); }} />}</Field>
    <Field label="Payment reference / note">{(props) => <input {...props} maxLength={500} value={note} disabled={mutation.isPending} onChange={(event) => setNote(event.target.value)} />}</Field>
    <label className="flex items-center gap-small text-sm"><input type="checkbox" required checked={confirmed} disabled={mutation.isPending} onChange={(event) => setConfirmed(event.target.checked)} />I have paid this amount to {row.name}.</label>
    {mutation.isError && <p role="alert" className="text-sm text-danger">{mutation.error.message}</p>}
    <Button type="submit" disabled={mutation.isPending || !confirmed}>{mutation.isPending ? "Recording..." : "Record payment"}</Button>
  </form>;
}

