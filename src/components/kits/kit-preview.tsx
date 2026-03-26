"use client";

import { useState } from "react";
import { ArrowRight, ChevronDown, Lock } from "lucide-react";
import { cn } from "@/lib/utils";
import type { KitWithSteps, WorkflowMapping } from "@/actions/kits";

type AgentRole = { role: string; name_suggestion?: string };
type LabelPreset = { name: string; color: string };

interface KitPreviewProps {
  kit: KitWithSteps;
  compact?: boolean;
}

const ROLE_ICONS: Record<string, string> = {
  "Full Stack Engineer": "\u{1F528}",
  "Front End Engineer": "\u{1F3A8}",
  "UX Designer": "\u{1F3A8}",
  "QA Engineer": "\u{1F50D}",
  "Security Engineer": "\u{1F6E1}\uFE0F",
  "DevOps Engineer": "\u{1F680}",
  "Product Owner": "\u{1F4CB}",
  "Business Analyst": "\u{1F4CA}",
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
  // Sort: primary first, then by name
  return Array.from(seen.values()).sort((a, b) => {
    if (a.mapping.is_primary && !b.mapping.is_primary) return -1;
    if (!a.mapping.is_primary && b.mapping.is_primary) return 1;
    return a.mapping.template_name.localeCompare(b.mapping.template_name);
  });
}

export function KitPreview({ kit, compact = false }: KitPreviewProps) {
  const [expanded, setExpanded] = useState(false);
  const [activeTab, setActiveTab] = useState(0);
  const agentRoles = (kit.agent_roles ?? []) as AgentRole[];
  const labelPresets = (kit.label_presets ?? []) as LabelPreset[];
  const workflowSteps = kit.workflow_steps ?? [];
  const mappings = kit.workflow_mappings ?? [];
  const isCustom = kit.name === "Custom";

  const hasMappings = mappings.length > 0;
  const uniqueTemplates = hasMappings ? getUniqueTemplates(mappings) : [];
  const triggerCount = mappings.length;
  const templateCount = uniqueTemplates.length;

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
            <span>{"\u{1F9D1}\u200D\u{1F4BB}"} {agentRoles.length} agent{agentRoles.length !== 1 ? "s" : ""}</span>
          )}
          {hasMappings ? (
            <>
              <span>{"\u26A1"} {templateCount} workflow{templateCount !== 1 ? "s" : ""}</span>
            </>
          ) : workflowSteps.length > 0 ? (
            <span>{"\u26A1"} {workflowSteps.length}-step workflow</span>
          ) : null}
          {labelPresets.length > 0 && (
            <span>{"\u{1F3F7}\uFE0F"} {labelPresets.length} label{labelPresets.length !== 1 ? "s" : ""}</span>
          )}
          {hasMappings ? (
            <span>{"\u{1F504}"} {triggerCount} trigger{triggerCount !== 1 ? "s" : ""}</span>
          ) : kit.auto_rule_label ? (
            <span>{"\u{1F504}"} 1 trigger</span>
          ) : null}
        </div>
      </div>
    );
  }

  // Summary bar counts
  const summaryWorkflowText = hasMappings
    ? `${templateCount} workflow${templateCount !== 1 ? "s" : ""}`
    : workflowSteps.length > 0
      ? `${workflowSteps.length}-step workflow`
      : null;
  const summaryTriggerText = hasMappings
    ? `${triggerCount} trigger${triggerCount !== 1 ? "s" : ""}`
    : kit.auto_rule_label
      ? "1 trigger"
      : null;

  return (
    <div aria-live="polite" className="animate-in slide-in-from-top-2 duration-200">
      {/* Summary toggle bar */}
      <button
        type="button"
        onClick={() => setExpanded((prev) => !prev)}
        className="mt-2 flex w-full items-center gap-2 rounded-lg border border-border px-3 py-2 text-xs text-muted-foreground transition-colors hover:bg-muted/30"
      >
        <ChevronDown
          className={cn(
            "h-3.5 w-3.5 shrink-0 transition-transform duration-200",
            expanded && "rotate-180"
          )}
        />
        <div className="flex flex-1 flex-wrap gap-3">
          {agentRoles.length > 0 && (
            <span>{"\u{1F9D1}\u200D\u{1F4BB}"} {agentRoles.length} agent{agentRoles.length !== 1 ? "s" : ""}</span>
          )}
          {summaryWorkflowText && <span>{"\u26A1"} {summaryWorkflowText}</span>}
          {labelPresets.length > 0 && (
            <span>{"\u{1F3F7}\uFE0F"} {labelPresets.length} label{labelPresets.length !== 1 ? "s" : ""}</span>
          )}
          {summaryTriggerText && <span>{"\u{1F504}"} {summaryTriggerText}</span>}
        </div>
        <span className="shrink-0 text-[11px] text-muted-foreground/60">
          {expanded ? "Hide" : "Show"} details
        </span>
      </button>

      {/* Expanded details */}
      {expanded && (
        <div className="mt-2 rounded-xl border border-border bg-card p-5 animate-in slide-in-from-top-2 duration-300">
          {/* Agent Team */}
          {agentRoles.length > 0 && (
            <div className="mb-4">
              <p className="mb-2 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                {"\u{1F9D1}\u200D\u{1F4BB}"} Agent Team ({agentRoles.length} role{agentRoles.length !== 1 ? "s" : ""})
              </p>
              <div className="flex flex-wrap gap-1.5">
                {agentRoles.map((role) => (
                  <span
                    key={role.role}
                    className="inline-flex items-center gap-1.5 rounded-md border border-border bg-muted/30 px-[0.7rem] py-[0.3rem] text-[0.78rem] text-muted-foreground"
                  >
                    <span className="text-[0.85rem]">{ROLE_ICONS[role.role] ?? "\u{1F464}"}</span>
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

          {/* Workflow Templates — Tabbed (Option B) or single chain */}
          {hasMappings && uniqueTemplates.length > 0 ? (
            <div className="mb-4">
              <p className="mb-2 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                {"\u26A1"} Workflow Templates ({templateCount})
              </p>

              {/* Tab buttons */}
              <div className="mb-2 flex flex-wrap gap-1" role="tablist">
                {uniqueTemplates.map((t, i) => (
                  <button
                    key={t.mapping.template_name}
                    type="button"
                    role="tab"
                    aria-selected={activeTab === i}
                    onClick={() => setActiveTab(i)}
                    className={cn(
                      "rounded-md px-2.5 py-1 text-[0.72rem] font-medium transition-colors",
                      activeTab === i
                        ? "bg-violet-500/[0.15] text-violet-400 border border-violet-500/25"
                        : "bg-muted/30 text-muted-foreground border border-transparent hover:bg-muted/50"
                    )}
                  >
                    {t.mapping.template_name}
                    <span className="ml-1 text-[0.65rem] text-muted-foreground/60">
                      ({t.mapping.template_step_count})
                    </span>
                  </button>
                ))}
              </div>

              {/* Active tab: step chain */}
              {uniqueTemplates[activeTab] && (
                <div role="tabpanel">
                  <div className="flex flex-wrap items-center gap-1.5">
                    {uniqueTemplates[activeTab].mapping.template_steps.map((step, i) => (
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

                  {/* "Triggered by" labels */}
                  <p className="mt-2 flex flex-wrap items-center gap-1.5 text-[0.7rem] text-muted-foreground/70">
                    <span>Triggered by:</span>
                    {uniqueTemplates[activeTab].labels.map((labelName) => {
                      const preset = labelPresets.find(
                        (lp) => lp.name.toLowerCase() === labelName.toLowerCase()
                      );
                      const colors = getLabelClasses(preset?.color ?? "zinc");
                      return (
                        <span
                          key={labelName}
                          className={cn(
                            "rounded-full px-2 py-0.5 text-[0.6rem] font-semibold",
                            colors.bg,
                            colors.text
                          )}
                        >
                          {labelName}
                        </span>
                      );
                    })}
                  </p>
                </div>
              )}
            </div>
          ) : workflowSteps.length > 0 ? (
            /* Fallback: single template step chain (old behaviour) */
            <div className="mb-4">
              <p className="mb-2 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                {"\u26A1"} Workflow Template ({workflowSteps.length} step{workflowSteps.length !== 1 ? "s" : ""})
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
          ) : null}

          {/* Board Labels */}
          {labelPresets.length > 0 && (
            <div className="mb-4">
              <p className="mb-2 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                {"\u{1F3F7}\uFE0F"} Board Labels
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

          {/* Workflow Triggers summary */}
          {hasMappings ? (
            <div>
              <p className="text-[0.7rem] text-muted-foreground/70">
                {"\u{1F504}"} {triggerCount} of {labelPresets.length} labels have workflow triggers.
                When a task is labelled, the matching workflow is automatically applied.
              </p>
            </div>
          ) : kit.auto_rule_label ? (
            <div>
              <p className="mb-1 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                {"\u{1F504}"} Workflow Trigger
              </p>
              <p className="text-xs text-muted-foreground">
                When a task is labelled{" "}
                <span className="rounded-full bg-violet-500/[0.12] px-1.5 py-0.5 text-[0.65rem] font-semibold text-violet-400">
                  {kit.auto_rule_label}
                </span>
                , the {kit.name} workflow will be automatically applied.
              </p>
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}
