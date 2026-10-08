import type { Metadata } from "next";
import { DashboardOverview } from "@/components/dashboard/dashboard-overview.tsx";

export const metadata: Metadata = { title: "Dashboard" };

export default function DashboardPage() {
  return <DashboardOverview />;
}
