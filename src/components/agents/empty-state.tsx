"use client";

import { useState } from "react";
import { Bot, Info, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { BOT_ROLE_TEMPLATES } from "@/lib/constants";
import { createBot } from "@/actions/bots";
import { toast } from "sonner";

const QUICK_TEMPLATES: { role: string; icon: string; description: string }[] = [
  { role: "Developer", icon: "\u{1F4BB}", description: "Clean, tested code" },
  { role: "UX Designer", icon: "\u{1F3A8}", description: "Usability & a11y" },
  { role: "QA Tester", icon: "\u{1F50D}", description: "Edge cases & bugs" },
  { role: "Product Owner", icon: "\u{1F4CB}", description: "Prioritisation" },
  { role: "Business Analyst", icon: "\u{1F4CA}", description: "Requirements" },
  { role: "DevOps", icon: "\u{2699}", description: "CI/CD & infra" },
];

interface EmptyStateProps {
  onCreateAgent: () => void;
  onBrowseCommunity: () => void;
}

export function EmptyState({ onCreateAgent, onBrowseCommunity }: EmptyStateProps) {
  const [creatingRole, setCreatingRole] = useState<string | null>(null);

  async function handleQuickCreate(role: string) {
    setCreatingRole(role);
    try {
      const template = BOT_ROLE_TEMPLATES.find((t) => t.role === role);
      if (!template) return;

      await createBot(
        role,
        template.role,
        template.prompt,
        null,
        null,
        []
      );
      toast.success(`Created ${role} agent`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to create agent");
    } finally {
      setCreatingRole(null);
    }
  }

  return (
    <div className="flex flex-col items-center gap-5 py-12 text-center">
      {/* Icon */}
      <div className="flex h-24 w-24 items-center justify-center rounded-full border-2 border-dashed border-border bg-primary/5">
        <Bot className="h-10 w-10 text-muted-foreground" />
      </div>

      {/* Title & description */}
      <div className="space-y-2">
        <h2 className="text-xl font-bold">Build your first agent</h2>
        <p className="max-w-md text-sm text-muted-foreground leading-relaxed">
          Agents are like AI team members &mdash; give them a role, personality,
          and tool access, then assign them to tasks on your idea boards. Start from
          scratch or pick a template below.
        </p>
      </div>

      {/* Dual CTAs */}
      <div className="flex items-center gap-3">
        <Button onClick={onCreateAgent} className="gap-2 px-5">
          <Plus className="h-4 w-4" />
          Create Agent
        </Button>
        <Button variant="outline" onClick={onBrowseCommunity} className="px-5">
          Browse Agents
        </Button>
      </div>

      {/* Divider */}
      <div className="flex items-center gap-3 w-full max-w-lg">
        <div className="flex-1 h-px bg-border" />
        <span className="text-xs text-muted-foreground">or quick-start with a template</span>
        <div className="flex-1 h-px bg-border" />
      </div>

      {/* Quick-start template chips */}
      <div className="w-full max-w-lg">
        <div className="grid grid-cols-3 gap-2 sm:grid-cols-3">
          {QUICK_TEMPLATES.map((t) => (
            <button
              key={t.role}
              onClick={() => handleQuickCreate(t.role)}
              disabled={creatingRole !== null}
              className="flex flex-col items-center gap-1.5 rounded-lg border border-border bg-muted/30 p-3.5 transition-colors hover:border-violet-500/30 hover:bg-muted/50 disabled:opacity-50"
            >
              <span className="text-xl">{t.icon}</span>
              <span className="text-xs font-semibold">{t.role}</span>
              <span className="text-[10px] text-muted-foreground leading-tight">
                {t.description}
              </span>
              {creatingRole === t.role && (
                <span className="text-[10px] text-primary">Creating...</span>
              )}
            </button>
          ))}
        </div>
      </div>

      {/* Info callout */}
      <div className="flex items-start gap-2.5 w-full max-w-lg rounded-lg bg-blue-500/10 border-l-[3px] border-blue-500 p-3 text-left">
        <Info className="h-4 w-4 shrink-0 text-blue-500 mt-0.5" />
        <p className="text-xs text-muted-foreground leading-relaxed">
          <span className="font-medium text-foreground">Quick start:</span>{" "}
          Click a template to pre-fill the create dialog, or add a full team at
          once from the <span className="font-medium text-foreground">Browse</span> tab&apos;s
          Featured Teams section.
        </p>
      </div>
    </div>
  );
}
