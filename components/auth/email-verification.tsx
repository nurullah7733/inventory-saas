"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/client/api.ts";
import { useSession, useSignOut } from "@/lib/client/use-session.ts";
import { updateSessionUser } from "@/lib/client/session.ts";
import type { ProfileResponse } from "@/lib/profile/schema.ts";
import { Button, Field } from "@/components/ui/field.tsx";

const LINK_STORAGE = "inventory-saas.email-verification-link";

export function EmailVerification({ compact = false }: { compact?: boolean }) {
  const { session } = useSession();
  const signOut = useSignOut();
  const router = useRouter();
  const cache = useQueryClient();
  const [token, setToken] = useState("");
  const capturedToken = useRef<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [verified, setVerified] = useState(false);
  const done = verified && !session?.user.pendingEmail;
  useEffect(() => {
    if (compact) return;
    let frame: number | undefined;
    const capture = (secret: string | null) => {
      if (!secret) return;
      capturedToken.current = secret;
      // Keep the secret only for this tab, so a reload or router remount cannot
      // lose the link after removing it from the address bar. Never use it
      // automatically: verification still requires an explicit button press.
      try {
        const previous = JSON.parse(window.sessionStorage.getItem(LINK_STORAGE) ?? "null") as { token: string; receivedAt: number } | null;
        if (previous?.token !== secret) window.sessionStorage.setItem(LINK_STORAGE, JSON.stringify({ token: secret, receivedAt: Date.now() }));
      } catch { /* Memory-only confirmation still works without storage. */ }
      window.history.replaceState(window.history.state, "", window.location.pathname);
      if (frame !== undefined) window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(() => setToken(secret));
    };
    const onHashChange = () => capture(new URLSearchParams(window.location.hash.slice(1)).get("token"));
    let saved: string | null = null;
    try {
      const previous = JSON.parse(window.sessionStorage.getItem(LINK_STORAGE) ?? "null") as { token: string; receivedAt: number } | null;
      if (previous && Date.now() - previous.receivedAt < 1800000) saved = previous.token;
      else window.sessionStorage.removeItem(LINK_STORAGE);
    } catch { /* Storage can be disabled. */ }
    capture(new URLSearchParams(window.location.hash.slice(1)).get("token") ?? capturedToken.current ?? saved);
    window.addEventListener("hashchange", onHashChange);
    return () => {
      window.removeEventListener("hashchange", onHashChange);
      if (frame !== undefined) window.cancelAnimationFrame(frame);
    };
  }, [compact]);
  const sync = async () => {
    if (!session || session.locked) return;
    const profile = await apiRequest<ProfileResponse>("/profile");
    updateSessionUser(profile.user);
    cache.setQueryData(["profile"], profile);
    await cache.invalidateQueries();
    if (profile.user.emailVerifiedAt) { setVerified(true); if (!compact) router.replace(session.user.role === "super_admin" ? "/admin" : "/dashboard"); }
    else setMessage("Your email has not been verified yet. Open the verification link in your inbox.");
  };
  const run = async (action: "verify" | "resend" | "check") => {
    setBusy(true); setMessage("");
    try {
      if (action === "verify") {
        await apiRequest("/auth/email-verification/verify", { method: "POST", anonymous: true, body: { token } });
        capturedToken.current = null;
        try { window.sessionStorage.removeItem(LINK_STORAGE); } catch { /* Storage disabled. */ }
        setToken(""); setVerified(true); setMessage("Email verified. You can now sign in with this email.");
        await sync();
      } else if (action === "resend") {
        await apiRequest("/auth/email-verification/resend", { method: "POST" });
        setMessage("Verification email sent. Check your inbox and spam folder.");
      } else await sync();
    } catch (error) { setMessage(error instanceof Error ? error.message : "Please try again."); }
    finally { setBusy(false); }
  };
  const changeEmail = async (form: HTMLFormElement) => {
    setBusy(true); setMessage("");
    try {
      const profile = await apiRequest<ProfileResponse>("/profile", { method: "PATCH", body: { email: String(new FormData(form).get("email")) } });
      updateSessionUser(profile.user); cache.setQueryData(["profile"], profile);
      setMessage("Check your new email for the verification link. Your current sign-in email stays active until verification.");
    } catch (error) { setMessage(error instanceof Error ? error.message : "Please try again."); }
    finally { setBusy(false); }
  };
  if (compact && !session?.user.pendingEmail && session?.user.emailVerifiedAt !== null) return null;
  return <section className="ui-panel ui-stack" aria-labelledby={compact ? "profile-email-title" : "verify-email-title"}>
    <h1 id={compact ? "profile-email-title" : "verify-email-title"} className="text-lg font-semibold">{done ? "Email verified" : "Verify your email"}</h1>
    <p className="text-sm text-muted break-words">{session ? `Check ${session.user.pendingEmail ?? session.user.email} for your verification link. Links expire after 30 minutes. ${session.user.pendingEmail ? "Your current sign-in email stays unchanged until verification." : "Verify your email to access your workspace."}` : "Open your email verification link, then select Verify email."}</p>
    <div className="ui-toolbar flex-wrap">
      {token && <Button disabled={busy} onClick={() => void run("verify")}>Verify email</Button>}
      {session && !done && <><Button disabled={busy} variant="ghost" onClick={() => void run("resend")}>Resend email</Button><Button disabled={busy} variant="ghost" onClick={() => void run("check")}>I have verified my email</Button></>}
      {!session && <Link href="/login" className="inline-flex min-h-11 items-center text-sm font-medium text-primary">Sign in</Link>}
      {session && !compact && <Button disabled={busy} variant="ghost" onClick={() => void signOut()}>Sign out</Button>}
    </div>
    {session?.user.emailVerifiedAt === null && !compact && <form className="ui-stack" onSubmit={(event) => { event.preventDefault(); void changeEmail(event.currentTarget); }}>
      <Field label="Use a different email" hint="Entered the wrong email at signup? Request verification at the correct address.">{(props) => <input {...props} name="email" type="email" autoComplete="email" maxLength={254} required defaultValue={session.user.pendingEmail ?? session.user.email} disabled={busy} />}</Field>
      <Button type="submit" disabled={busy}>Send to new email</Button>
    </form>}
    {message && <p className="text-sm text-muted" role="status">{message}</p>}
  </section>;
}
