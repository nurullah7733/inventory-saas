import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { ApiProblem } from "../api/response.ts";

export interface EmailMessage { to: string[]; subject: string; text: string }

/** Reusable transactional email transport; file output is never allowed in production. */
export async function deliverEmail(message: EmailMessage, fileId: string) {
  const transport = process.env.EMAIL_TRANSPORT ?? (process.env.NODE_ENV === "production" ? "resend" : "file");
  try {
    if (transport === "file" && process.env.NODE_ENV !== "production") {
      const folder = join(process.cwd(), ".mail");
      await mkdir(folder, { recursive: true });
      await writeFile(join(folder, `${fileId}.json`), JSON.stringify(message, null, 2), { mode: 0o600 });
    } else if (transport === "resend" && process.env.RESEND_API_KEY && process.env.EMAIL_FROM) {
      const response = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({ ...message, from: process.env.EMAIL_FROM }),
        signal: AbortSignal.timeout(10000),
      });
      if (!response.ok) throw new Error("Delivery rejected");
    } else throw new Error("Delivery not configured");
  } catch {
    // Provider responses may contain recipient details or secrets. Do not log them.
    throw new ApiProblem("EMAIL_UNAVAILABLE", "Could not send email. Please try again later.", 503);
  }
}
