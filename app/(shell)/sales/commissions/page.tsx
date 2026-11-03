import type { Metadata } from "next";
import { CommissionsManager } from "@/components/sales/commissions-manager.tsx";
export const metadata: Metadata = { title: "Sales & commission" };
export default function CommissionsPage() {
  return <CommissionsManager />;
}
