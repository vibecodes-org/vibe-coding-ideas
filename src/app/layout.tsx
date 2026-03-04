import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { Analytics } from "@vercel/analytics/react";
import { SpeedInsights } from "@vercel/speed-insights/next";
import { ThemeProvider } from "next-themes";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ServiceWorkerRegister } from "@/components/pwa/service-worker-register";
import { InstallPrompt } from "@/components/pwa/install-prompt";
import { PostHogProvider } from "@/components/posthog/posthog-provider";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#ffffff" },
    { media: "(prefers-color-scheme: dark)", color: "#09090b" },
  ],
};

const appUrl = process.env.NEXT_PUBLIC_APP_URL || "https://vibecodes.co.uk";

const siteDescription =
  "The AI-powered idea board where you go from concept to shipped code. Share ideas, build your team, and let AI handle the rest via MCP.";

export const metadata: Metadata = {
  title: {
    default: "VibeCodes — AI-Powered Idea Board for Vibe Coding",
    template: "%s | VibeCodes",
  },
  description: siteDescription,
  metadataBase: new URL(appUrl),
  openGraph: {
    type: "website",
    locale: "en_GB",
    siteName: "VibeCodes",
    title: "VibeCodes — AI-Powered Idea Board for Vibe Coding",
    description: siteDescription,
    url: appUrl,
  },
  twitter: {
    card: "summary_large_image",
    title: "VibeCodes — AI-Powered Idea Board for Vibe Coding",
    description: siteDescription,
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "VibeCodes",
  },
  icons: {
    icon: "/icon.svg",
    apple: "/apple-touch-icon.png",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        <PostHogProvider>
          <ThemeProvider
            attribute="class"
            defaultTheme="dark"
            enableSystem
            disableTransitionOnChange
          >
            <TooltipProvider>
              {children}
            </TooltipProvider>
            <Toaster />
          </ThemeProvider>
        </PostHogProvider>
        <Analytics />
        <SpeedInsights />
        <ServiceWorkerRegister />
        <InstallPrompt />
      </body>
    </html>
  );
}
