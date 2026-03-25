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

  const [githubResult, kits, aiAccess, botsResult] = await Promise.all([
    supabase
      .from("users")
      .select("github_username")
      .eq("id", user.id)
      .maybeSingle(),
    getActiveKitsWithSteps(),
    getAiAccess(),
    supabase
      .from("bot_profiles")
      .select("id, name, role, system_prompt, is_active")
      .eq("owner_id", user.id)
      .eq("is_active", true)
      .order("name"),
  ]);

  const githubUsername = githubResult.data?.github_username ?? null;
  const bots = (botsResult.data ?? []).map((b) => ({
    id: b.id,
    full_name: b.name,
    role: b.role,
    system_prompt: b.system_prompt,
    is_active: b.is_active,
  }));

  return (
    <div className="mx-auto max-w-3xl px-4 py-8">
      <IdeaForm
        githubUsername={githubUsername}
        userId={user.id}
        kits={kits}
        canUseAi={aiAccess.canUseAi}
        hasByokKey={aiAccess.hasApiKey}
        starterCredits={aiAccess.starterCredits}
        bots={bots}
      />
    </div>
  );
}
