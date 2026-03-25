import { requireAuth } from "@/lib/auth";
import { IdeaForm } from "@/components/ideas/idea-form";
import { getActiveKitsWithSteps } from "@/actions/kits";
import { getAiAccess } from "@/actions/ai";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Submit Idea",
  description: "Share your vibe coding project idea with the community.",
  robots: { index: false, follow: false },
};

export default async function NewIdeaPage() {
  const { user, supabase } = await requireAuth();

  const [githubResult, kits, aiAccess] = await Promise.all([
    supabase
      .from("users")
      .select("github_username")
      .eq("id", user.id)
      .maybeSingle(),
    getActiveKitsWithSteps(),
    getAiAccess(),
  ]);

  const githubUsername = githubResult.data?.github_username ?? null;

  return (
    <div className="mx-auto max-w-3xl px-4 py-8">
      <IdeaForm
        githubUsername={githubUsername}
        userId={user.id}
        kits={kits}
        canUseAi={aiAccess.canUseAi}
        hasByokKey={aiAccess.hasApiKey}
        starterCredits={aiAccess.starterCredits}
      />
    </div>
  );
}
