import { Suspense } from "react";
import type { Metadata } from "next";
import { PinUnlock } from "@/components/auth/pin-unlock.tsx";

export const metadata: Metadata = { title: "Unlock" };
export default function UnlockPage() {
  return <div className="flex flex-1 items-center justify-center p-content">
    <Suspense fallback={<p role="status" className="text-sm text-muted">Loading unlock screen...</p>}><PinUnlock /></Suspense>
  </div>;
}
