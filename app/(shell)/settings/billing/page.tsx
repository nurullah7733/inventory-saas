import { Suspense } from "react";
import { BillingManager } from "@/components/billing/billing-manager.tsx";
export const metadata = { title: "Subscription & billing" };
export default function Page() { return <Suspense fallback={<p>Loading billing…</p>}><BillingManager /></Suspense>; }
