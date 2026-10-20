import { NextResponse } from "next/server";
import { completeCallback } from "@/lib/billing/service.ts";
import { billingConfig } from "@/lib/billing/config.ts";
import { consume } from "@/lib/api/rate-limit.ts";

export const runtime = "nodejs";
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const reference = params.get("reference") ?? "";
  const target = new URL(`${billingConfig().appUrl}/settings/billing`);
  const limit = consume(`bkash-callback:${reference.slice(0, 36)}`, { limit: 10, windowSeconds: 60 });
  if (!limit.allowed) return new NextResponse("Please wait before checking payment again.", { status: 429 });
  try {
    const result = await completeCallback(reference, params.get("token") ?? "", params.get("paymentID") ?? "", params.get("status") === "success");
    target.searchParams.set("checkout", result.status);
  } catch {
    // Leave uncertain payments pending so the owner can reconcile them safely.
    target.searchParams.set("checkout", "pending");
  }
  const response = NextResponse.redirect(target, 303);
  response.headers.set("Cache-Control", "no-store");
  response.headers.set("Referrer-Policy", "no-referrer");
  return response;
}
