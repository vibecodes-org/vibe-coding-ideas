"use client";

import { useState, useCallback } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { TurnstileWidget } from "./turnstile-widget";

/** Map raw Supabase auth errors to user-friendly messages */
export function friendlyAuthError(message: string): string {
  const lower = message.toLowerCase();
  if (lower.includes("email rate limit exceeded") || lower.includes("rate limit")) {
    return "Too many attempts — please wait a few minutes and try again.";
  }
  if (lower.includes("invalid login credentials")) {
    return "Incorrect email or password.";
  }
  if (lower.includes("email not confirmed")) {
    return "Please check your inbox and confirm your email before signing in.";
  }
  return message;
}

interface EmailAuthFormProps {
  mode: "login" | "signup";
}

export function EmailAuthForm({ mode }: EmailAuthFormProps) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [existingAccount, setExistingAccount] = useState(false);
  const [loading, setLoading] = useState(false);
  const [captchaToken, setCaptchaToken] = useState<string | null>(null);

  const handleCaptchaToken = useCallback(
    (token: string | null) => setCaptchaToken(token),
    [],
  );

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccess(null);
    setExistingAccount(false);
    setLoading(true);

    const supabase = createClient();
    const captchaOpts = captchaToken ? { captchaToken } : {};

    if (mode === "login") {
      const { error } = await supabase.auth.signInWithPassword({
        email,
        password,
        options: captchaOpts,
      });
      if (error) {
        setError(friendlyAuthError(error.message));
        setLoading(false);
      } else {
        router.push("/dashboard");
      }
    } else {
      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: {
          emailRedirectTo: `${window.location.origin}/callback`,
          ...captchaOpts,
        },
      });
      if (error) {
        setError(friendlyAuthError(error.message));
        setLoading(false);
      } else if (data.user?.identities?.length === 0) {
        setExistingAccount(true);
        setLoading(false);
      } else {
        setSuccess("Check your email to confirm your account.");
        setLoading(false);
      }
    }
  };

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <Label htmlFor="email">Email</Label>
        <Input
          id="email"
          type="email"
          placeholder="you@example.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
          disabled={loading}
        />
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor="password">Password</Label>
        <Input
          id="password"
          type="password"
          placeholder="Your password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
          minLength={6}
          disabled={loading}
        />
      </div>
      {error && (
        <p className="text-sm text-destructive">{error}</p>
      )}
      {existingAccount && (
        <p className="text-sm text-destructive">
          An account with this email already exists. Try{" "}
          <Link href="/login" className="font-medium underline hover:text-destructive/80">
            signing in
          </Link>{" "}
          or{" "}
          <Link href="/forgot-password" className="font-medium underline hover:text-destructive/80">
            resetting your password
          </Link>
          .
        </p>
      )}
      {success && (
        <p className="text-sm text-green-600 dark:text-green-400">{success}</p>
      )}
      <TurnstileWidget onToken={handleCaptchaToken} />
      <Button type="submit" size="lg" className="w-full" disabled={loading}>
        {loading
          ? mode === "login"
            ? "Signing in..."
            : "Creating account..."
          : mode === "login"
            ? "Sign in with email"
            : "Create account"}
      </Button>
    </form>
  );
}
