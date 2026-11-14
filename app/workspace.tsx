"use client";

import { useEffect, useState } from "react";
import type { Session, SupabaseClient } from "@supabase/supabase-js";
import { Infinity as InfinityIcon } from "lucide-react";
import Link from "next/link";
import Dashboard from "./dashboard";
import { demoMode, getSupabase, type Profile } from "../lib/supabase";

export default function Workspace({ signup = false }: { signup?: boolean }) {
  const [client, setClient] = useState<SupabaseClient | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);
  const [profileLoaded, setProfileLoaded] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [pending, setPending] = useState(false);
  const [passwordSetup, setPasswordSetup] = useState(false);
  const [retry, setRetry] = useState(0);
  const [confirmationEmail, setConfirmationEmail] = useState("");

  function authError(error: unknown) {
    const code = (error as { code?: string })?.code;
    if (code === "signup_disabled")
      return "New accounts are not available yet. Please contact themobiusenterprises@gmail.com for help joining.";
    if (code === "email_address_not_authorized" || code === "unexpected_failure")
      return "We could not send your confirmation email. Please contact themobiusenterprises@gmail.com for help.";
    if (code === "over_email_send_rate_limit" || code === "over_request_rate_limit")
      return "Too many attempts. Please wait a few minutes before trying again.";
    return error instanceof Error ? error.message : "Please try again.";
  }

  useEffect(() => {
    if (demoMode) {
      setLoading(false);
      return;
    }
    let supabase: SupabaseClient | null;
    try {
      supabase = getSupabase();
    } catch (e) {
      setError((e as Error).message);
      setLoading(false);
      return;
    }
    setClient(supabase);
    if (!supabase) {
      setLoading(false);
      return;
    }
    const callback = new URLSearchParams(window.location.hash.slice(1));
    const type = callback.get("type");
    if (callback.has("error")) {
      setError(
        callback.get("error_code") === "otp_expired"
          ? "This email link has expired or was already used. Request a new link and try again."
          : "Sign-in was cancelled or could not be completed. Please try again.",
      );
      // Remove failed callback parameters so a reload does not repeat them.
      window.history.replaceState(null, "", window.location.pathname + window.location.search);
    }
    setPasswordSetup(type === "invite" || type === "recovery");
    let cancelled = false;
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, newSession) => {
      if (cancelled) return;
      setSession(newSession);
      setLoading(false);
      if (event === "PASSWORD_RECOVERY") setPasswordSetup(true);
      if (!newSession) {
        setProfile(null);
        setProfileLoaded(false);
        setPasswordSetup(false);
      }
    });
    supabase.auth
      .getSession()
      .then(({ data, error }) => {
        if (cancelled) return;
        if (error) setError(error.message);
        setSession(data.session);
        setLoading(false);
      })
      .catch(() => {
        if (!cancelled) {
          setError(
            "Could not reach authentication. Please reload and try again.",
          );
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
      subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (!client || !session) return;
    let cancelled = false;
    setProfileLoaded(false);
    setError("");
    async function refresh() {
      const { data, error } = await client!
        .from("profiles")
        .select("id,email,role,active")
        .eq("id", session!.user.id)
        .single();
      if (cancelled) return;
      if (error) {
        setError(
          "Could not load your membership. Check the database setup or retry.",
        );
        setProfile(null);
      } else {
        setProfile(data as Profile);
        setError("");
      }
      setProfileLoaded(true);
    }
    void refresh();
    const timer = setInterval(() => void refresh(), 15000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [client, session?.user.id, retry]);

  async function signOut() {
    if (!client) return;
    setPending(true);
    const { error } = await client.auth.signOut();
    if (error) setError(error.message);
    setPending(false);
  }

  async function authenticate(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!client || pending) return;
    const form = new FormData(e.currentTarget),
      password = String(form.get("password"));
    setPending(true);
    setError("");
    setMessage("");
    try {
      if (passwordSetup) {
        const { error } = await client.auth.updateUser({ password });
        if (error) throw error;
        setPasswordSetup(false);
        setMessage("Password saved.");
      } else if (signup) {
        const email = String(form.get("email")).trim();
        const { data, error } = await client.auth.signUp({
          email,
          password,
          options: { emailRedirectTo: window.location.origin },
        });
        if (error) throw error;
        // A session is only returned when email confirmation is disabled.
        // The inactive profile still prevents workspace access in that case.
        if (!data.session) setConfirmationEmail(email);
      } else {
        const { error } = await client.auth.signInWithPassword({
          email: String(form.get("email")),
          password,
        });
        if (error) throw error;
      }
    } catch (e) {
      setError(authError(e));
    } finally {
      setPending(false);
    }
  }

  async function resendConfirmation() {
    if (!client || pending || !confirmationEmail) return;
    setPending(true);
    setError("");
    setMessage("");
    try {
      const { error } = await client.auth.resend({
        type: "signup",
        email: confirmationEmail,
        options: { emailRedirectTo: window.location.origin },
      });
      if (error) throw error;
      setMessage("If this address is awaiting confirmation, a new link is on its way. Check your spam folder too.");
    } catch (e) {
      setError(authError(e));
    } finally {
      setPending(false);
    }
  }

  async function signInWithGoogle() {
    if (!client || pending) return;
    setPending(true);
    setError("");
    setMessage("");
    try {
      const { error } = await client.auth.signInWithOAuth({
        provider: "google",
        options: { redirectTo: window.location.origin },
      });
      if (error) throw error;
    } catch {
      setError("Could not start Google sign-in. Please try again or sign in with email.");
    } finally {
      setPending(false);
    }
  }

  async function resetPassword(e: React.MouseEvent<HTMLButtonElement>) {
    const form = e.currentTarget.form;
    if (!client || !form || pending) return;
    const email = form.querySelector<HTMLInputElement>("input[name=email]");
    if (!email?.reportValidity()) return;
    setPending(true);
    setError("");
    try {
      const { error } = await client.auth.resetPasswordForEmail(email.value, {
        redirectTo: window.location.origin,
      });
      if (error) throw error;
      setMessage(
        "If that address has an account, a password reset link will arrive by email.",
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not send reset email.");
    } finally {
      setPending(false);
    }
  }

  if (demoMode) return <Dashboard />;
  if (
    !loading &&
    session &&
    profileLoaded &&
    profile?.active &&
    !passwordSetup &&
    client
  )
    return (
      <Dashboard
        key={profile.id + profile.role}
        account={profile}
        client={client}
        signOut={signOut}
      />
    );

  return (
    <main className="auth-shell">
      <div className="auth-card">
        <div className="brand">
          <span className="brand-icon">
            <InfinityIcon size={28} />
          </span>
          mobius<span className="brand-dot">.</span>
        </div>
        {loading ? (
          <p role="status">Connecting to your workspace…</p>
        ) : !client ? (
          <>
            <h1>Connect your workspace</h1>
            <p>
              Supabase is not configured yet. Add your project URL and
              publishable key to the environment settings, then rebuild the app.
            </p>
            <p>
              Setup instructions are in <code>docs/supabase.md</code>. Demo mode
              must be explicitly enabled for sample data.
            </p>
          </>
        ) : session && !profileLoaded ? (
          <p role="status">Loading your membership…</p>
        ) : session && !profile && !passwordSetup ? (
          <>
            <h1>Membership unavailable</h1>
            <button
              className="primary full"
              onClick={() => setRetry((n) => n + 1)}
            >
              Retry
            </button>
            <button className="text-button" onClick={signOut}>
              Sign out
            </button>
          </>
        ) : session && profile && !profile.active && !passwordSetup ? (
          <>
            <h1>Awaiting group approval</h1>
            <p>
              You’re signed in as {session.user.email}. Your account is awaiting
              administrator approval. Deals and reservations become available
              after your membership is approved. This page checks automatically.
            </p>
            <button
              className="primary full"
              onClick={() => setRetry((n) => n + 1)}
            >
              Check membership
            </button>
            <button className="text-button" onClick={signOut}>
              Sign out
            </button>
          </>
        ) : confirmationEmail && !session && !passwordSetup ? (
          <>
            <h1>Check your email</h1>
            <p>
              If {confirmationEmail} can be registered, you’ll receive a
              confirmation link. Open it to verify your email, then wait for
              administrator approval. Check your spam folder too.
            </p>
            <button className="primary full" disabled={pending} onClick={resendConfirmation}>
              {pending ? "Please wait…" : "Resend confirmation email"}
            </button>
            <p>Already have an account? <Link className="auth-link" href="/workspace">Sign in</Link></p>
            <button className="text-button" disabled={pending} onClick={() => {
              setConfirmationEmail(""); setError(""); setMessage("");
            }}>Use a different email</button>
          </>
        ) : (
          <>
            <h1>
              {passwordSetup
                ? "Set your password"
                : signup
                  ? "Join Mobius"
                : "Welcome to your buying group"}
            </h1>
            <p>
              {passwordSetup
                ? "Choose a password for your Mobius account."
                : signup
                  ? "Create your account, confirm your email, and wait for administrator approval before accessing the group."
                  : "Sign in with your Mobius email and password."}
            </p>
            {!passwordSetup && (
              <>
                <button type="button" className="google-auth" disabled={pending} onClick={signInWithGoogle}>
                  <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
                    <path fill="#4285F4" d="M21.6 12.23c0-.71-.06-1.39-.18-2.05H12v3.88h5.38a4.6 4.6 0 0 1-1.99 3.02v2.51h3.23c1.89-1.74 2.98-4.3 2.98-7.36Z" />
                    <path fill="#34A853" d="M12 22c2.7 0 4.96-.9 6.62-2.41l-3.23-2.51c-.9.6-2.05.96-3.39.96-2.6 0-4.8-1.75-5.59-4.1H3.07v2.59A10 10 0 0 0 12 22Z" />
                    <path fill="#FBBC05" d="M6.41 13.94a6 6 0 0 1 0-3.88V7.47H3.07a10 10 0 0 0 0 9.06l3.34-2.59Z" />
                    <path fill="#EA4335" d="M12 5.96c1.47 0 2.79.51 3.82 1.51l2.87-2.87A9.6 9.6 0 0 0 12 2a10 10 0 0 0-8.93 5.47l3.34 2.59C7.2 7.71 9.4 5.96 12 5.96Z" />
                  </svg>
                  Continue with Google
                </button>
                <div className="auth-divider"><span>or use email</span></div>
              </>
            )}
            <form onSubmit={authenticate}>
              {!passwordSetup && (
                <label>
                  Email
                  <input
                    autoComplete="username"
                    type="email"
                    name="email"
                    required
                  />
                </label>
              )}
              <label>
                {passwordSetup ? "New password" : "Password"}
                <input
                  type="password"
                  name="password"
                  minLength={passwordSetup || signup ? 12 : undefined}
                  maxLength={256}
                  autoComplete={
                    passwordSetup || signup ? "new-password" : "current-password"
                  }
                  aria-describedby={passwordSetup || signup ? "password-help" : undefined}
                  required
                />
              </label>
              {(signup || passwordSetup) && <p id="password-help">Use at least 12 characters.</p>}
              <button disabled={pending} className="primary full">
                {pending
                  ? "Please wait…"
                  : passwordSetup
                    ? "Save password"
                    : signup
                      ? "Create account"
                    : "Sign in"}
              </button>
              {!passwordSetup && !signup && (
                <button
                  type="button"
                  className="text-button auth-reset"
                  onClick={resetPassword}
                  disabled={pending}
                >
                  Forgot password?
                </button>
              )}
            </form>
            {!passwordSetup && (
              <p>{signup ? "Already a member? " : "New to Mobius? "}
                <Link className="auth-link" href={signup ? "/workspace" : "/join"}>
                  {signup ? "Sign in" : "Create an account"}
                </Link>
              </p>
            )}
          </>
        )}
        {error && (
          <p role="alert" className="error">
            {error}
          </p>
        )}
        {message && (
          <p role="status" className="form-help">
            {message}
          </p>
        )}
        <p><Link className="auth-link" href="/">← Back to Mobius</Link></p>
      </div>
    </main>
  );
}
