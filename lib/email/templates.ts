import { EmailMessage } from "./delivery.ts";

export interface EmailParams {
  to: string | string[];
  subject: string;
  text: string;
  html?: string;
}

/** Generic, reusable composer: any caller passes subject/text/html/to dynamically. */
export function composeEmail(params: EmailParams): EmailMessage {
  const { to, subject, text, html } = params;
  const message: EmailMessage = {
    to: Array.isArray(to) ? to : [to],
    subject,
    text,
  };
  if (html) message.html = html;
  return message;
}

/** Verification email: sent for signup and on email change. */
export function emailVerificationTemplate(
  to: string,
  url: string,
  validMinutes = 30,
): EmailMessage {
  return composeEmail({
    to,
    subject: "Verify your email",
    text: `Verify your email within ${validMinutes} minutes: ${url}\nIf you did not request this, ignore this email.`,
    html: `<p>Verify your email within <strong>${validMinutes} minutes</strong>:</p><p><a href="${url}">Verify email</a></p><p>If you did not request this, ignore this email.</p>`,
  });
}

/** Password-reset email: single-use template built on the generic composer. */
export function passwordResetTemplate(
  to: string,
  url: string,
  validMinutes = 30,
): EmailMessage {
  return composeEmail({
    to,
    subject: "Reset your password",
    text: `Reset your password within ${validMinutes} minutes: ${url}\nIf you did not request this, ignore this email. Your password has not changed.`,
    html: `<p>Reset your password within <strong>${validMinutes} minutes</strong>:</p><p><a href="${url}">Reset password</a></p><p>If you did not request this, ignore this email. Your password has not changed.</p>`,
  });
}
