import { ApiProblem } from "../api/response.ts";
import { billingConfig, type BillingConfig } from "./config.ts";

export interface BkashPayment {
  paymentID?: string; trxID?: string; transactionStatus?: string;
  amount?: string; currency?: string; merchantInvoiceNumber?: string; merchantInvoice?: string;
  bkashURL?: string; statusCode?: string; id_token?: string; verificationStatus?: string;
}
export interface BkashGateway {
  create(invoice: string, amount: string, callbackURL: string): Promise<BkashPayment>;
  execute(paymentID: string): Promise<BkashPayment>;
  query(paymentID: string): Promise<BkashPayment>;
}
export function bkashCheckoutUrl(payment: BkashPayment, sandbox: boolean): string {
  if (payment.statusCode !== "0000" || !payment.paymentID) {
    const code = /^\d{4}$/.test(payment.statusCode ?? "") ? ` (code ${payment.statusCode})` : "";
    throw new ApiProblem("BILLING_UNAVAILABLE", `bKash could not create checkout${code}.`, 503);
  }
  let url: URL;
  try { url = new URL(payment.bkashURL!); } catch { throw new ApiProblem("BILLING_UNAVAILABLE", "bKash returned an invalid checkout URL.", 503); }
  const apiHost = sandbox ? "sandbox.bka.sh" : "pay.bka.sh";
  const paymentHost = sandbox ? "sandbox.payment.bkash.com" : "payment.bkash.com";
  if (url.protocol !== "https:" || url.username || url.password || url.port ||
    !(url.hostname === paymentHost || url.hostname === apiHost || url.hostname.endsWith(`.${apiHost}`)))
    throw new ApiProblem("BILLING_UNAVAILABLE", "bKash returned an unsupported checkout URL.", 503);
  return url.toString();
}
export function bkashGateway(config: BillingConfig = billingConfig(), transport: typeof fetch = fetch): BkashGateway {
  let token: string | undefined;
  async function request(path: string, body: object, headers: Record<string, string>): Promise<BkashPayment> {
    try {
      const response = await transport(`${config.baseUrl}/tokenized/checkout/${path}`, {
        method: "POST", headers: { Accept: "application/json", "Content-Type": "application/json", ...headers },
        body: JSON.stringify(body), cache: "no-store", signal: AbortSignal.timeout(15_000), redirect: "error",
      });
      if (!response.ok) throw new Error("bKash HTTP error");
      return await response.json();
    } catch {
      throw new ApiProblem("BILLING_UNAVAILABLE", "bKash could not confirm this request. Check payment status before retrying.", 503);
    }
  }
  async function call(path: string, body: object) {
    if (!token) {
      const result = await request("token/grant", { app_key: config.appKey, app_secret: config.appSecret },
        { username: config.username, password: config.password });
      if (!result.id_token || result.statusCode !== "0000") throw new ApiProblem("BILLING_UNAVAILABLE", "bKash authentication is unavailable.", 503);
      token = result.id_token;
    }
    return request(path, body, { Authorization: token, "X-APP-Key": config.appKey });
  }
  return {
    create: (invoice, amount, callbackURL) => call("create", { mode: "0011", payerReference: invoice,
      callbackURL, amount, currency: "BDT", intent: "sale", merchantInvoiceNumber: invoice }),
    execute: (paymentID) => call("execute", { paymentID }),
    query: async (paymentID) => {
      const payment = await call("payment/status", { paymentID });
      // Query uses merchantInvoice; create/execute use merchantInvoiceNumber.
      return { ...payment, merchantInvoiceNumber: payment.merchantInvoiceNumber ?? payment.merchantInvoice };
    },
  };
}
