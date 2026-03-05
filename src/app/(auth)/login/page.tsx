import Link from "next/link";
import { Sparkles } from "lucide-react";
import { OAuthButtons } from "@/components/auth/oauth-buttons";
import { EmailAuthForm } from "@/components/auth/email-auth-form";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Log In",
  description: "Log in to your VibeCodes account.",
};

export default function LoginPage() {
  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <Link href="/" className="mb-4 flex items-center justify-center gap-2">
            <Sparkles className="h-8 w-8 text-primary" />
            <span className="text-2xl font-bold">VibeCodes</span>
          </Link>
          <CardTitle>Welcome back</CardTitle>
          <CardDescription>
            Log in to your account to continue
          </CardDescription>
        </CardHeader>
        <CardContent>
          <OAuthButtons />
          <div className="relative my-6">
            <div className="absolute inset-0 flex items-center">
              <span className="w-full border-t" />
            </div>
            <div className="relative flex justify-center text-xs uppercase">
              <span className="bg-card px-2 text-muted-foreground">or</span>
            </div>
          </div>
          <EmailAuthForm mode="login" />
          <p className="mt-4 text-center text-sm">
            <Link href="/forgot-password" className="text-muted-foreground hover:text-primary hover:underline">
              Forgot password?
            </Link>
          </p>
          <p className="mt-4 text-center text-sm text-muted-foreground">
            Don&apos;t have an account?{" "}
            <Link href="/signup" className="font-medium text-primary hover:underline">
              Sign up
            </Link>
          </p>
          <p className="mt-2 text-center text-xs text-muted-foreground">
            <Link href="/guide" prefetch={false} className="hover:text-primary hover:underline">
              Learn more about VibeCodes
            </Link>
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
