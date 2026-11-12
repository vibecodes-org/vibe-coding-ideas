"use client";

import { useEffect, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { oauthIssuer } from "@/lib/oauth-redirect";
import {
  Card,
  CardDescription,
  CardHeader,
} from "@/components/ui/card";
import { Sparkles } from "lucide-react";

function generateCode(): string {
  const array = new Uint8Array(32);
  globalThis.crypto.getRandomValues(array);
  return Array.from(array, (b) => b.toString(16).padStart(2, "0")).join("");
}

function OAuthCallbackContent() {
  const searchParams = useSearchParams();

  useEffect(() => {
    const handleCallback = async () => {
      // Exchange the OAuth code for a session (Supabase handles this via URL hash)
      const supabase = createClient();
      const { data: { session }, error } = await supabase.auth.getSession();

      if (error || !session) {
        // Session not ready yet — wait for Supabase to process the hash
        // Supabase client auto-detects the hash fragment and exchanges the code
        const { data: { subscription } } = supabase.auth.onAuthStateChange(
          async (event, newSession) => {
            if (event === "SIGNED_IN" && newSession) {
              subscription.unsubscribe();
              await completeFlow(newSession.access_token, newSession.refresh_token);
            }
          }
        );
        return;
      }

      await completeFlow(session.access_token, session.refresh_token);
    };

    async function completeFlow(accessToken: string, refreshToken: string) {
      const clientId = searchParams.get("client_id");
      const redirectUri = searchParams.get("redirect_uri");
      const codeChallenge = searchParams.get("code_challenge");
      const codeChallengeMethod = searchParams.get("code_challenge_method") || "S256";
      const state = searchParams.get("state");
      const scope = searchParams.get("scope") || "";

      if (!clientId || !redirectUri || !codeChallenge || !state) {
        return;
      }

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

      if (response.ok) {
        const finalRedirect = new URL(redirectUri);
        finalRedirect.searchParams.set("code", code);
        finalRedirect.searchParams.set("state", state);
        finalRedirect.searchParams.set("iss", oauthIssuer(window.location.origin));
        window.location.href = finalRedirect.toString();
      }
    }

    handleCallback();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <div className="mb-4 flex items-center justify-center gap-2">
            <Sparkles className="h-8 w-8 text-primary" />
            <span className="text-2xl font-bold">VibeCodes</span>
          </div>
          <CardDescription>Completing authorization...</CardDescription>
        </CardHeader>
      </Card>
    </div>
  );
}

export default function OAuthCallbackPage() {
  return (
    <Suspense>
      <OAuthCallbackContent />
    </Suspense>
  );
}
