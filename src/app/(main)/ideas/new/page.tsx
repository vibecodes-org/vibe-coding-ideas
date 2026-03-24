import { requireAuth } from "@/lib/auth";
import { IdeaForm } from "@/components/ideas/idea-form";
import { getActiveKitsWithSteps } from "@/actions/kits";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Submit Idea",
  description: "Share your vibe coding project idea with the community.",
  robots: { index: false, follow: false },
};

export default async function NewIdeaPage() {
  const { user, supabase } = await requireAuth();

  const [githubResult, kits] = await Promise.all([
    supabase
      .from("users")
      .select("github_username")
      .eq("id", user.id)
      .maybeSingle(),
    getActiveKitsWithSteps(),
  ]);

  const githubUsername = githubResult.data?.github_username ?? null;

  return (
    <div className="mx-auto max-w-3xl px-4 py-8">
      <IdeaForm githubUsername={githubUsername} userId={user.id} kits={kits} />
    </div>
  );
}
