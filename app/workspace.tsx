"use client";

import { useEffect, useState } from "react";
import type { Session, SupabaseClient } from "@supabase/supabase-js";
import { Infinity as InfinityIcon } from "lucide-react";
import Dashboard from "./dashboard";
import { demoMode, getSupabase, type Profile } from "../lib/supabase";

export default function Workspace() {
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
    const type = new URLSearchParams(window.location.hash.slice(1)).get("type");
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
      } else {
        const { error } = await client.auth.signInWithPassword({
          email: String(form.get("email")),
          password,
        });
        if (error) throw error;
      }
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Could not sign in. Please try again.",
      );
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
              You’re signed in as {session.user.email}. Ask your group
              administrator to activate your membership.
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
        ) : (
          <>
            <h1>
              {passwordSetup
                ? "Set your password"
                : "Welcome to your buying group"}
            </h1>
            <p>
              {passwordSetup
                ? "Choose a password for your Mobius account."
                : "Sign in with the email address your group admin invited."}
            </p>
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
                  minLength={passwordSetup ? 12 : undefined}
                  maxLength={256}
                  autoComplete={
                    passwordSetup ? "new-password" : "current-password"
                  }
                  required
                />
              </label>
              <button disabled={pending} className="primary full">
                {pending
                  ? "Please wait…"
                  : passwordSetup
                    ? "Save password"
                    : "Sign in"}
              </button>
              {!passwordSetup && (
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
      </div>
    </main>
  );
}
