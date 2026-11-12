"use client";

import { useState, useEffect, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { oauthIssuer } from "@/lib/oauth-redirect";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Sparkles, Terminal } from "lucide-react";

function generateCode(): string {
  const array = new Uint8Array(32);
  globalThis.crypto.getRandomValues(array);
  return Array.from(array, (b) => b.toString(16).padStart(2, "0")).join("");
}

function OAuthAuthorizeContent() {
  const searchParams = useSearchParams();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [checkingSession, setCheckingSession] = useState(true);

  const clientId = searchParams.get("client_id");
  const redirectUri = searchParams.get("redirect_uri");
  const codeChallenge = searchParams.get("code_challenge");
  const codeChallengeMethod = searchParams.get("code_challenge_method") || "S256";
  const state = searchParams.get("state");
  const scope = searchParams.get("scope") || "";

  const isValid = clientId && redirectUri && codeChallenge && state;

  // Check for existing session on mount
  useEffect(() => {
    if (!isValid) {
      setCheckingSession(false);
      return;
    }

    const checkSession = async () => {
      const supabase = createClient();
      // Validate session server-side (getSession only reads local storage)
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        setCheckingSession(false);
        return;
      }
      // Refresh to get the freshest token pair with maximum TTL
      const { data: { session } } = await supabase.auth.refreshSession();
      if (session) {
        await completeAuthorization(session.access_token, session.refresh_token);
      } else {
        setCheckingSession(false);
      }
    };

    checkSession();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function completeAuthorization(accessToken: string, refreshToken: string) {
    const code = generateCode();

    const response = await fetch("/api/oauth/code", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        code,
        client_id: clientId,
        redirect_uri: redirectUri,
        code_challenge: codeChallenge,
        code_challenge_method: codeChallengeMethod,
        scope,
        supabase_access_token: accessToken,
        supabase_refresh_token: refreshToken,
      }),
    });

    if (!response.ok) {
      setError("Failed to generate authorization code. Please try again.");
      setCheckingSession(false);
      setLoading(false);
      return;
    }

    // Redirect back to Claude Code with the auth code
    const redirectUrl = new URL(redirectUri!);
    redirectUrl.searchParams.set("code", code);
    redirectUrl.searchParams.set("state", state!);
    redirectUrl.searchParams.set("iss", oauthIssuer(window.location.origin));
    window.location.href = redirectUrl.toString();
  }

  const handleEmailLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);

    const supabase = createClient();
    const { data, error: authError } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (authError) {
      setError(authError.message);
      setLoading(false);
      return;
    }

    if (data.session) {
      await completeAuthorization(
        data.session.access_token,
        data.session.refresh_token
      );
    }
  };

  const handleOAuth = async (provider: "github" | "google") => {
    setLoading(true);
    const supabase = createClient();

    // Build the callback URL that preserves MCP OAuth params
    const callbackUrl = new URL(`${window.location.origin}/oauth/callback`);
    callbackUrl.searchParams.set("client_id", clientId!);
    callbackUrl.searchParams.set("redirect_uri", redirectUri!);
    callbackUrl.searchParams.set("code_challenge", codeChallenge!);
    callbackUrl.searchParams.set("code_challenge_method", codeChallengeMethod);
    callbackUrl.searchParams.set("state", state!);
    callbackUrl.searchParams.set("scope", scope);

    const { error: authError } = await supabase.auth.signInWithOAuth({
      provider,
      options: {
        redirectTo: callbackUrl.toString(),
      },
    });

    if (authError) {
      setError(authError.message);
      setLoading(false);
    }
  };

  if (!isValid) {
    return (
      <div className="flex min-h-screen items-center justify-center px-4">
        <Card className="w-full max-w-md">
          <CardHeader className="text-center">
            <CardTitle>Invalid Request</CardTitle>
            <CardDescription>
              Missing required OAuth parameters. Please try connecting again from Claude Code.
            </CardDescription>
          </CardHeader>
        </Card>
      </div>
    );
  }

  if (checkingSession) {
    return (
      <div className="flex min-h-screen items-center justify-center px-4">
        <Card className="w-full max-w-md">
          <CardHeader className="text-center">
            <div className="mb-4 flex items-center justify-center gap-2">
              <Sparkles className="h-8 w-8 text-primary" />
              <span className="text-2xl font-bold">VibeCodes</span>
            </div>
            <CardDescription>Checking your session...</CardDescription>
          </CardHeader>
        </Card>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <div className="mb-4 flex items-center justify-center gap-2">
            <Sparkles className="h-8 w-8 text-primary" />
            <span className="text-2xl font-bold">VibeCodes</span>
          </div>
          <div className="mx-auto mb-2 flex items-center gap-2 rounded-md bg-muted px-3 py-1.5 text-sm text-muted-foreground">
            <Terminal className="h-4 w-4" />
            Claude Code wants access
          </div>
          <CardTitle>Authorize MCP Connection</CardTitle>
          <CardDescription>
            Sign in to grant Claude Code access to your VibeCodes ideas and tasks.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col gap-3">
            <Button
              variant="outline"
              size="lg"
              className="w-full gap-2"
              onClick={() => handleOAuth("github")}
              disabled={loading}
            >
              <svg className="h-5 w-5" viewBox="0 0 24 24" fill="currentColor">
                <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z" />
              </svg>
              {loading ? "Connecting..." : "Continue with GitHub"}
            </Button>
            <Button
              variant="outline"
              size="lg"
              className="w-full gap-2"
              onClick={() => handleOAuth("google")}
              disabled={loading}
            >
              <svg className="h-5 w-5" viewBox="0 0 24 24">
                <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4" />
                <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" />
                <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05" />
                <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335" />
              </svg>
              {loading ? "Connecting..." : "Continue with Google"}
            </Button>
          </div>

          <div className="relative my-6">
            <div className="absolute inset-0 flex items-center">
              <span className="w-full border-t" />
            </div>
            <div className="relative flex justify-center text-xs uppercase">
              <span className="bg-card px-2 text-muted-foreground">or</span>
            </div>
          </div>

          <form onSubmit={handleEmailLogin} className="flex flex-col gap-4">
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
            {error && <p className="text-sm text-destructive">{error}</p>}
            <Button type="submit" size="lg" className="w-full" disabled={loading}>
              {loading ? "Signing in..." : "Sign in & Authorize"}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}

export default function OAuthAuthorizePage() {
  return (
    <Suspense>
      <OAuthAuthorizeContent />
    </Suspense>
  );
}
