import { notFound } from "next/navigation";
import { ReportsManager } from "@/components/reports/reports-manager.tsx";
import { REPORT_KINDS, type ReportKind } from "@/lib/reports/types.ts";
export const metadata = { title: "Reports" };
export default async function Page({ params }: { params: Promise<{ kind: string }> }) {
  const { kind } = await params;
  if (!REPORT_KINDS.includes(kind as ReportKind)) notFound();
  return <ReportsManager key={kind} kind={kind as ReportKind} />;
}
