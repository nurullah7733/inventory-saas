import { handleWithErrors } from "@/lib/api/guard.ts";
import { apiError, apiSuccess } from "@/lib/api/response.ts";
import { billingWebhookSecret } from "@/lib/billing/config.ts";
import { subscriptionIdFromEvent } from "@/lib/billing/events.ts";
import { syncSubscription } from "@/lib/billing/service.ts";
import { verifyStripeEvent } from "@/lib/billing/stripe.ts";

export const runtime = "nodejs";
export async function POST(request: Request) {
  // Stripe has no bearer token. Verify the exact raw body BEFORE opening a database transaction.
  return handleWithErrors(async () => {
    const signature = request.headers.get("stripe-signature");
    if (!signature) return apiError("VALIDATION_ERROR", "Stripe signature required.", 400);
    if (Number(request.headers.get("content-length") ?? 0) > 1_048_576) return apiError("VALIDATION_ERROR", "Webhook payload too large.", 413);
    const secret = billingWebhookSecret();
    const body = await request.text();
    if (Buffer.byteLength(body) > 1_048_576) return apiError("VALIDATION_ERROR", "Webhook payload too large.", 413);
    let event;
    try { event = verifyStripeEvent(body, signature, secret); }
    catch { return apiError("VALIDATION_ERROR", "Invalid Stripe signature or payload.", 400); }
    const subscriptionId = subscriptionIdFromEvent(event);
    if (subscriptionId) await syncSubscription(subscriptionId);
    return apiSuccess({ received: true });
  });
}
