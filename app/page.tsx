import { redirect } from "next/navigation";

/**
 * The root is not a screen in this product — it is a fork.
 *
 * Sending everyone to `/dashboard` is safe because `proxy.ts` is the thing
 * that decides: a visitor with no session hint is redirected on to `/login`
 * before this app ever renders, and a signed-in one lands on their dashboard.
 * Duplicating that decision here would mean two places to keep in agreement.
 */
export default function Home() {
  redirect("/dashboard");
}
