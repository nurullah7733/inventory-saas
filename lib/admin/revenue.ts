import type { AuthContext } from "../auth/context.ts";
import { assertPlatform } from "./service.ts";
import type { RevenueSummary } from "./types.ts";

export async function platformRevenue(auth: AuthContext): Promise<RevenueSummary> {
  assertPlatform(auth);
  return { available: false, message: "bKash plans are prepaid. Recurring revenue does not apply; payments are recorded in billing history.",
    asOf: new Date().toISOString(), currencies: [], excluded: 0 };
}
