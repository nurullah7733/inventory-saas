"use client";

import Link from "next/link";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { apiRequest } from "@/lib/client/api.ts";
import { Button, Field } from "@/components/ui/field.tsx";
import { REPORT_KINDS, REPORT_LABELS, reportFilterSchema, type Report, type ReportKind } from "@/lib/reports/types.ts";
import { reportDay } from "@/lib/reports/calculations.ts";

export function ReportsManager({ kind }: { kind: ReportKind }) {
  const today = reportDay(new Date().toISOString());
  const [draft, setDraft] = useState({ from: today.slice(0, 8) + "01", to: today });
  const [filter, setFilter] = useState(draft);
  const [error, setError] = useState("");
  const [exporting, setExporting] = useState(false);
  const query = useQuery({ queryKey: ["reports", kind, filter],
    queryFn: ({ signal }) => apiRequest<{ report: Report }>(`/reports/${kind}?${new URLSearchParams(filter)}`, { signal }) });
  const report = query.data?.report;
  async function download(format: "pdf" | "excel") {
    if (!report || exporting) return;
    setExporting(true);
    try {
      const exports = await import("@/lib/reports/export.ts");
      await (format === "pdf" ? exports.exportPdf(report) : exports.exportExcel(report));
      toast.success(`${format === "pdf" ? "PDF" : "Excel"} report downloaded.`);
    } catch (error) { toast.error(error instanceof Error ? error.message : "Export failed. Please try again."); }
    finally { setExporting(false); }
  }
  const max = Math.max(1, ...(report?.trend.map((d) => Math.abs(Number(d.sales))) ?? []));
  return <div className="flex flex-col gap-5">
    <nav aria-label="Report types" className="flex flex-wrap gap-2">{REPORT_KINDS.map((k) => <Link key={k} href={`/reports/${k}`} aria-current={k === kind ? "page" : undefined}
      className={`rounded-lg border px-3 py-2 text-sm ${k === kind ? "bg-zinc-900 text-white" : "border-zinc-300"}`}>{REPORT_LABELS[k]}</Link>)}</nav>
    <div><h1 className="text-xl font-semibold">{REPORT_LABELS[kind]} Report</h1><p className="mt-1 text-sm text-zinc-500">Filter your shop records and download PDF or Excel.</p></div>
    <form className="grid gap-3 sm:grid-cols-3" onSubmit={(event) => {
      event.preventDefault(); const result = reportFilterSchema.safeParse(draft);
      if (!result.success) { setError(result.error.issues[0].message); return; }
      setError(""); setFilter(result.data);
    }}>
      <Field label="From">{(props) => <input {...props} type="date" required value={draft.from} onChange={(e) => setDraft({ ...draft, from: e.target.value })} />}</Field>
      <Field label="To">{(props) => <input {...props} type="date" required value={draft.to} onChange={(e) => setDraft({ ...draft, to: e.target.value })} />}</Field>
      <div className="flex items-end"><Button type="submit" disabled={query.isFetching}>Apply dates</Button></div>
    </form>
    {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
    <div className="flex flex-wrap gap-2"><Button disabled={!report || query.isFetching || exporting} onClick={() => void download("pdf")}>{exporting ? "Exporting…" : "Download PDF"}</Button>
      <Button variant="ghost" disabled={!report || query.isFetching || exporting} onClick={() => void download("excel")}>Download Excel</Button>
      <Button variant="ghost" disabled={query.isFetching} onClick={() => void query.refetch()}>Refresh</Button></div>
    {query.isPending && <p role="status">Loading report…</p>}
    {query.isError && <p role="alert" className="text-red-600">{query.error.message}</p>}
    {report && <>
      <p className="text-sm text-zinc-500">{report.from} — {report.to} · Currency: {report.currency}</p>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">{report.summary.map((m) => <div key={m.label} className="rounded-xl border border-zinc-200 p-4 dark:border-zinc-800">
        <p className="text-sm text-zinc-500">{m.label}</p><p className="mt-2 break-words text-lg font-semibold">{m.money && `${report.currency} `}{m.value}</p></div>)}</div>
      {report.notes.map((note) => <p key={note} className="text-sm text-zinc-500">{note}</p>)}
      {!!report.trend.length && <section aria-label="Daily sales trend" className="rounded-xl border p-4"><h2 className="font-semibold">Daily trend</h2>
        <div className="mt-3 max-h-72 space-y-2 overflow-y-auto">{report.trend.map((d) => <div key={d.date} className="grid grid-cols-[6rem_1fr] items-center gap-3 text-xs">
          <span>{d.date}</span><div><div className={`h-3 rounded ${Number(d.sales) < 0 ? "bg-red-400" : "bg-emerald-500"}`} style={{ width: `${Math.max(1, Math.abs(Number(d.sales)) / max * 100)}%` }} />
            <span>Sales {d.sales}{d.netProfit !== undefined ? ` · Net profit ${d.netProfit}` : ""}</span></div></div>)}</div></section>}
      {report.tables.map((table) => <section key={table.title}><h2 className="mb-3 font-semibold">{table.title} ({table.rows.length})</h2>
        {!table.rows.length ? <p className="text-sm text-zinc-500">No records in this period.</p> : <>
          <div className="hidden max-h-[32rem] overflow-auto rounded-lg border sm:block"><table className="w-full text-left text-sm"><thead className="sticky top-0 bg-zinc-100 dark:bg-zinc-900"><tr>{table.columns.map((c) => <th key={c} className="p-3">{c}</th>)}</tr></thead>
            <tbody>{table.rows.map((row, i) => <tr key={i} className="border-t">{row.map((value, j) => <td key={j} className="break-words p-3">{value}</td>)}</tr>)}</tbody></table></div>
          <div className="max-h-[32rem] space-y-3 overflow-auto sm:hidden">{table.rows.map((row, i) => <dl key={i} className="rounded-xl border p-3">{row.map((value, j) => <div key={j} className="flex justify-between gap-3 py-1 text-sm"><dt className="text-zinc-500">{table.columns[j]}</dt><dd className="min-w-0 break-words text-right">{value || "—"}</dd></div>)}</dl>)}</div>
        </>}
      </section>)}
    </>}
  </div>;
}
