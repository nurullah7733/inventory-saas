import type Stripe from "stripe";
const objectId = (value: unknown) => typeof value === "string" ? value :
  value && typeof value === "object" && "id" in value && typeof value.id === "string" ? value.id : null;
/** Read only identifiers from signed snapshots; retrieve state using the SDK's pinned API version. */
export function subscriptionIdFromEvent(event: Stripe.Event): string | null {
  const object = event.data.object;
  switch (event.type) {
    case "customer.subscription.created": case "customer.subscription.updated": case "customer.subscription.deleted":
    case "customer.subscription.paused": case "customer.subscription.resumed":
      return objectId(object);
    case "checkout.session.completed": case "checkout.session.async_payment_succeeded": case "checkout.session.async_payment_failed":
      return "subscription" in object ? objectId(object.subscription) : null;
    case "invoice.paid": case "invoice.payment_failed": case "invoice.payment_action_required": case "invoice.finalization_failed":
      if ("parent" in object && object.parent?.type === "subscription_details") return objectId(object.parent.subscription_details?.subscription);
      // Older webhook destinations can send a pre-Basil Invoice snapshot.
      return "subscription" in object ? objectId(object.subscription) : null;
    default: return null;
  }
}
