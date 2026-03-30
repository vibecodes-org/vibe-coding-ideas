"use client";

import { useState, useEffect } from "react";
import { ArrowRight, Lock } from "lucide-react";
import { cn } from "@/lib/utils";
import type { KitWithSteps, WorkflowMapping } from "@/actions/kits";

type AgentRole = { role: string; name_suggestion?: string };
type LabelPreset = { name: string; color: string };

interface KitPreviewProps {
  kit: KitWithSteps;
  /** Index of the selected card in the grid (0-based) for arrow positioning */
  selectedIndex?: number;
  /** Number of columns in the grid */
  columnCount?: number;
}

const ROLE_META: Record<string, { icon: string; short: string }> = {
  "Full Stack Engineer": { icon: "\u{1F528}", short: "Full Stack" },
  "Front End Engineer": { icon: "\u{1F3A8}", short: "Frontend" },
  "UX Designer": { icon: "\u{1F3A8}", short: "UX" },
  "QA Engineer": { icon: "\u{1F50D}", short: "QA" },
  "Security Engineer": { icon: "\u{1F6E1}\uFE0F", short: "Security" },
  "DevOps Engineer": { icon: "\u{1F680}", short: "DevOps" },
  "Product Owner": { icon: "\u{1F4CB}", short: "PO" },
  "Business Analyst": { icon: "\u{1F4CA}", short: "BA" },
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

/** Get unique templates from mappings, preserving primary-first order */
function getUniqueTemplates(mappings: WorkflowMapping[]) {
  const seen = new Map<string, { mapping: WorkflowMapping; labels: string[] }>();
  for (const m of mappings) {
    const existing = seen.get(m.template_name);
    if (existing) {
      existing.labels.push(m.label_name);
    } else {
      seen.set(m.template_name, { mapping: m, labels: [m.label_name] });
    }
  }
  return Array.from(seen.values()).sort((a, b) => {
    if (a.mapping.is_primary && !b.mapping.is_primary) return -1;
    if (!a.mapping.is_primary && b.mapping.is_primary) return 1;
    return a.mapping.template_name.localeCompare(b.mapping.template_name);
  });
}

export function KitPreview({ kit, selectedIndex = 0, columnCount = 3 }: KitPreviewProps) {
  const [expandedWf, setExpandedWf] = useState(0);
  const agentRoles = (kit.agent_roles ?? []) as AgentRole[];
  const labelPresets = (kit.label_presets ?? []) as LabelPreset[];
  const mappings = kit.workflow_mappings ?? [];
  const isCustom = kit.name === "Custom";
  const uniqueTemplates = mappings.length > 0 ? getUniqueTemplates(mappings) : [];

  // All workflows collapsed by default when kit changes
  useEffect(() => {
    setExpandedWf(-1);
  }, [kit.id]);

  // Arrow position based on which column the selected card is in
  const col = selectedIndex % columnCount;
  const arrowLeftPercent = ((col + 0.5) / columnCount) * 100;

  return (
    <div
      className="relative mt-2 rounded-[10px] border border-violet-500 bg-zinc-900 p-4 shadow-[0_8px_32px_rgba(0,0,0,0.5),0_0_20px_rgba(139,92,246,0.25)] animate-in slide-in-from-top-2 duration-200"
      aria-live="polite"
    >
      {/* Arrow */}
      <div
        className="absolute -top-[6px] h-[10px] w-[10px] rotate-45 border-l border-t border-violet-500 bg-zinc-900"
        style={{ left: `calc(${arrowLeftPercent}% - 5px)` }}
      />

      {/* Header */}
      <div className="mb-3 flex items-center gap-2.5 border-b border-violet-500/15 pb-3">
        <span className="text-xl">{kit.icon}</span>
        <div>
          <div className="text-sm font-bold">{kit.name}</div>
          <div className="text-[0.65rem] text-muted-foreground">{kit.description}</div>
        </div>
      </div>

      {/* Custom empty state */}
      {isCustom && (
        <p className="py-2 text-center text-sm text-muted-foreground">
          Start from scratch — add agents, workflows, and labels after setup.
        </p>
      )}

      {/* AI Team */}
      {agentRoles.length > 0 && (
        <div className="mb-3">
          <p className="mb-1.5 text-[0.6rem] font-semibold uppercase tracking-wider text-muted-foreground/70">
            Your AI Team ({agentRoles.length})
          </p>
          <div className="flex flex-wrap gap-1.5">
            {agentRoles.map((role) => {
              const meta = ROLE_META[role.role];
              return (
                <span
                  key={role.role}
                  className="inline-flex items-center gap-1 rounded-md border border-border bg-white/[0.04] px-2 py-0.5 text-[0.7rem] text-muted-foreground"
                  title={role.role}
                >
                  <span className="text-[0.8rem]">{meta?.icon ?? "\u{1F464}"}</span>
                  {meta?.short ?? role.role}
                </span>
              );
            })}
          </div>
        </div>
      )}

      {/* Workflows */}
      {uniqueTemplates.length > 0 && (
        <div>
          <p className="mb-1.5 text-[0.6rem] font-semibold uppercase tracking-wider text-muted-foreground/70">
            Workflows{" "}
            <span className="font-normal normal-case tracking-normal text-muted-foreground/50">
              — click to view steps
            </span>
          </p>
          <div className="flex flex-col gap-1">
            {uniqueTemplates.map((t, i) => {
              const isExpanded = expandedWf === i;
              const triggerLabels = t.labels
                .map((name) => {
                  const preset = labelPresets.find(
                    (lp) => lp.name.toLowerCase() === name.toLowerCase()
                  );
                  return { name, color: preset?.color ?? "zinc" };
                });

              return (
                <div key={t.mapping.template_name}>
                  {/* Workflow row */}
                  <button
                    type="button"
                    onClick={() => setExpandedWf(isExpanded ? -1 : i)}
                    className={cn(
                      "flex w-full items-center justify-between gap-2 rounded-md border px-2.5 py-1.5 text-left transition-all",
                      isExpanded
                        ? "border-violet-500 bg-violet-500/[0.12]"
                        : "border-border bg-white/[0.02] hover:border-violet-500/30 hover:bg-white/[0.04]"
                    )}
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      {t.mapping.is_primary && (
                        <span className="shrink-0 rounded bg-violet-500/[0.12] px-1 py-px text-[0.5rem] font-bold text-violet-400">
                          PRIMARY
                        </span>
                      )}
                      <span className="truncate text-[0.7rem] font-semibold">
                        {t.mapping.template_name}
                      </span>
                      <span className="shrink-0 text-[0.6rem] text-muted-foreground/50">
                        {t.mapping.template_step_count} steps
                      </span>
                    </div>
                    <div className="flex shrink-0 gap-1">
                      {triggerLabels.map((l) => {
                        const colors = getLabelClasses(l.color);
                        return (
                          <span
                            key={l.name}
                            className={cn(
                              "rounded-full px-1.5 py-px text-[0.55rem] font-semibold",
                              colors.bg,
                              colors.text
                            )}
                          >
                            {l.name}
                          </span>
                        );
                      })}
                    </div>
                  </button>

                  {/* Expanded step chain */}
                  {isExpanded && t.mapping.template_steps && (
                    <div className="mt-1 rounded-md border border-violet-500/10 bg-violet-500/[0.04] px-2.5 py-2 animate-in slide-in-from-top-1 duration-150">
                      <div className="flex flex-wrap items-center gap-1">
                        {t.mapping.template_steps.map((step, si) => (
                          <span key={si} className="contents">
                            {si > 0 && (
                              <ArrowRight className="h-2.5 w-2.5 shrink-0 text-muted-foreground/40" />
                            )}
                            <span
                              className={cn(
                                "inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[0.65rem] text-muted-foreground",
                                step.requires_approval
                                  ? "bg-amber-500/10 border border-amber-500/20"
                                  : "bg-white/[0.06]"
                              )}
                            >
                              {step.title}
                              {step.requires_approval && (
                                <Lock className="h-2.5 w-2.5 text-amber-400" />
                              )}
                            </span>
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {/* Key */}
          <div className="mt-2.5 flex items-center gap-3 text-[0.55rem] text-muted-foreground/50">
            <span className="inline-flex items-center gap-1">
              <Lock className="h-2.5 w-2.5 text-amber-400" />
              Requires your approval
            </span>
            <span className="inline-flex items-center gap-1">
              ⚡ Labels auto-assign workflows
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
