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
  title: "Sign Up",
  description: "Create a free VibeCodes account and start sharing ideas.",
};

export default function SignupPage() {
  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <Link href="/" className="mb-4 flex items-center justify-center gap-2">
            <Sparkles className="h-8 w-8 text-primary" />
            <span className="text-2xl font-bold">VibeCodes</span>
          </Link>
          <CardTitle>Create your account</CardTitle>
          <CardDescription>
            Join the community and start sharing ideas
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
          <EmailAuthForm mode="signup" />
          <p className="mt-4 text-center text-xs text-muted-foreground">
            New here?{" "}
            <Link href="/guide" prefetch={false} className="font-medium text-primary hover:underline">
              Read our getting started guide
            </Link>
          </p>
          <p className="mt-2 text-center text-xs text-muted-foreground">
            By signing up, you agree to our{" "}
            <Link href="/privacy" className="text-primary hover:underline">
              Privacy Policy
            </Link>
          </p>
          <p className="mt-3 text-center text-sm text-muted-foreground">
            Already have an account?{" "}
            <Link href="/login" className="font-medium text-primary hover:underline">
              Log in
            </Link>
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
