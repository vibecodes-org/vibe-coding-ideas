"use client";

import { ArrowRight, Lock } from "lucide-react";
import { cn } from "@/lib/utils";
import type { KitWithSteps } from "@/actions/kits";

type AgentRole = { role: string; name_suggestion?: string };
type LabelPreset = { name: string; color: string };

interface KitPreviewProps {
  kit: KitWithSteps;
  compact?: boolean;
}

const ROLE_ICONS: Record<string, string> = {
  "Full Stack Engineer": "🔨",
  "Front End Engineer": "🎨",
  "UX Designer": "🎨",
  "QA Engineer": "🔍",
  "Security Engineer": "🛡️",
  "DevOps Engineer": "🚀",
  "Product Owner": "📋",
  "Business Analyst": "📊",
};

const LABEL_COLOR_MAP: Record<string, { bg: string; text: string }> = {
  red: { bg: "bg-red-500/[0.12]", text: "text-red-400" },
  rose: { bg: "bg-rose-500/[0.12]", text: "text-rose-400" },
  orange: { bg: "bg-orange-500/[0.12]", text: "text-orange-400" },
  amber: { bg: "bg-amber-500/[0.12]", text: "text-amber-400" },
  lime: { bg: "bg-lime-500/[0.12]", text: "text-lime-400" },
  green: { bg: "bg-emerald-500/[0.12]", text: "text-emerald-400" },
  emerald: { bg: "bg-emerald-500/[0.12]", text: "text-emerald-400" },
  cyan: { bg: "bg-cyan-500/[0.12]", text: "text-cyan-400" },
  blue: { bg: "bg-blue-500/[0.12]", text: "text-blue-400" },
  violet: { bg: "bg-violet-500/[0.12]", text: "text-violet-400" },
  purple: { bg: "bg-violet-500/[0.12]", text: "text-violet-400" },
  pink: { bg: "bg-pink-500/[0.12]", text: "text-pink-400" },
  zinc: { bg: "bg-zinc-500/[0.12]", text: "text-zinc-400" },
};

function getLabelClasses(color: string) {
  return LABEL_COLOR_MAP[color] ?? LABEL_COLOR_MAP.zinc;
}

export function KitPreview({ kit, compact = false }: KitPreviewProps) {
  const agentRoles = (kit.agent_roles ?? []) as AgentRole[];
  const labelPresets = (kit.label_presets ?? []) as LabelPreset[];
  const workflowSteps = kit.workflow_steps ?? [];
  const isCustom = kit.name === "Custom";

  if (isCustom) return null;

  if (compact) {
    return (
      <div
        className="mt-3 rounded-lg border border-border bg-card p-3 animate-in slide-in-from-top-2 duration-200"
        aria-live="polite"
      >
        <p className="mb-1 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
          What you&apos;ll get
        </p>
        <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
          {agentRoles.length > 0 && (
            <span>🧑‍💻 {agentRoles.length} agent{agentRoles.length !== 1 ? "s" : ""}</span>
          )}
          {workflowSteps.length > 0 && (
            <span>⚡ {workflowSteps.length}-step workflow</span>
          )}
          {labelPresets.length > 0 && (
            <span>🏷️ {labelPresets.length} label{labelPresets.length !== 1 ? "s" : ""}</span>
          )}
          {kit.auto_rule_label && <span>🔄 1 auto-rule</span>}
        </div>
      </div>
    );
  }

  return (
    <div
      className="rounded-xl border border-border bg-card p-6 animate-in slide-in-from-top-2 duration-300"
      aria-live="polite"
    >
      {/* Header */}
      <div className="mb-4">
        <h3 className="font-bold">
          {kit.icon} {kit.name} Kit
        </h3>
        {kit.description && (
          <p className="mt-0.5 text-xs text-muted-foreground">
            {kit.description}
          </p>
        )}
      </div>

      {/* Agent Team */}
      {agentRoles.length > 0 && (
        <div className="mb-4">
          <p className="mb-2 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
            🧑‍💻 Agent Team ({agentRoles.length} role{agentRoles.length !== 1 ? "s" : ""})
          </p>
          <div className="flex flex-wrap gap-1.5">
            {agentRoles.map((role) => (
              <span
                key={role.role}
                className="inline-flex items-center gap-1.5 rounded-md border border-border bg-muted/30 px-[0.7rem] py-[0.3rem] text-[0.78rem] text-muted-foreground"
              >
                <span className="text-[0.85rem]">{ROLE_ICONS[role.role] ?? "👤"}</span>
                {role.role}
              </span>
            ))}
          </div>
          <p className="mt-2 text-[11px] text-muted-foreground/70">
            Agents will be cloned to your account. You can customise names,
            prompts, and skills afterwards.
          </p>
        </div>
      )}

      {/* Workflow Template */}
      {workflowSteps.length > 0 && (
        <div className="mb-4">
          <p className="mb-2 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
            ⚡ Workflow Template ({workflowSteps.length} step{workflowSteps.length !== 1 ? "s" : ""})
          </p>
          <div className="flex flex-wrap items-center gap-1.5">
            {workflowSteps.map((step, i) => (
              <span key={i} className="contents">
                {i > 0 && (
                  <ArrowRight className="h-3 w-3 shrink-0 text-muted-foreground/50" />
                )}
                <span
                  className={cn(
                    "inline-flex items-center gap-1.5 rounded-md border px-[0.7rem] py-[0.3rem] text-[0.78rem] text-muted-foreground",
                    step.requires_approval
                      ? "border-amber-500/25 bg-amber-500/[0.12]"
                      : "border-border bg-muted/30"
                  )}
                >
                  {i + 1}. {step.title}
                  {step.requires_approval && (
                    <Lock className="h-3 w-3 text-amber-400" />
                  )}
                </span>
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Board Labels */}
      {labelPresets.length > 0 && (
        <div className="mb-4">
          <p className="mb-2 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
            🏷️ Board Labels
          </p>
          <div className="flex flex-wrap gap-1.5">
            {labelPresets.map((label) => {
              const colors = getLabelClasses(label.color);
              return (
                <span
                  key={label.name}
                  className={cn(
                    "rounded-full px-2 py-0.5 text-[0.65rem] font-semibold",
                    colors.bg,
                    colors.text
                  )}
                >
                  {label.name}
                </span>
              );
            })}
          </div>
        </div>
      )}

      {/* Auto-Rule */}
      {kit.auto_rule_label && (
        <div>
          <p className="mb-1 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
            🔄 Auto-Rule
          </p>
          <p className="text-xs text-muted-foreground">
            When a task is labelled{" "}
            <span className="rounded-full bg-violet-500/[0.12] px-1.5 py-0.5 text-[0.65rem] font-semibold text-violet-400">
              {kit.auto_rule_label}
            </span>
            , the {kit.name} workflow will be automatically applied.
          </p>
        </div>
      )}
    </div>
  );
}
