import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getLandingStats } from "@/lib/landing-stats";
import { AuroraHeader } from "@/components/landing/aurora-header";
import { AuroraHero } from "@/components/landing/aurora-hero";
import { AgentRelay } from "@/components/landing/agent-relay";
import { FeatureTiles } from "@/components/landing/feature-tiles";
import { ClosingBand } from "@/components/landing/closing-band";
import { AuroraFooter } from "@/components/landing/aurora-footer";
import styles from "@/components/landing/aurora.module.css";

const appUrl = process.env.NEXT_PUBLIC_APP_URL || "https://vibecodes.co.uk";

export const metadata: Metadata = {
  alternates: { canonical: appUrl },
};

export default async function LandingPage() {
  const supabase = await createClient();

  const { data: { user } } = await supabase.auth.getUser();
  if (user) redirect("/dashboard");

  // Only after the redirect check: signed-in visitors never pay for this read.
  const stats = await getLandingStats();

  return (
    <div className={styles.aurora}>
      <AuroraHeader />
      <main>
        <AuroraHero stats={stats} />
        <AgentRelay />
        <FeatureTiles />
        <ClosingBand />
      </main>
      <AuroraFooter />
    </div>
  );
}
