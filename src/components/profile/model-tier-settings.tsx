"use client";

import { useState, useTransition } from "react";
import { Cpu, TriangleAlert } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { updateTerminalPreferences } from "@/actions/profile";
import { setViewerAgentAwareModelTierMapCache } from "@/hooks/use-viewer-model-tier-map";
import { setViewerTerminalModelCache } from "@/hooks/use-viewer-terminal-model";
import { setViewerTerminalAutoAcceptCache } from "@/hooks/use-viewer-terminal-auto-accept";
import { usePlatformAgentAwareModelDefaults } from "@/hooks/use-platform-model-defaults";
import { usePlatformTerminalModelDefault } from "@/hooks/use-platform-terminal-model-default";
import { usePlatformTerminalCodexModelDefault } from "@/hooks/use-platform-terminal-codex-model-default";
import {
  MODEL_TIER_WHEN_TO_USE,
  capitalizeModelName,
  tierResolutionLine,
  type ModelAlias,
  type ModelTierValue,
} from "@/lib/constants";
import {
  MACHINE_DEFAULT_TERMINAL_MODEL,
  KNOWN_TERMINAL_MODEL_ALIASES,
  isKnownTerminalModelAlias,
  resolveEffectiveTerminalCodexModelWithSource,
  validateTerminalModelValue,
  capitalizeTerminalModelName,
} from "@/lib/terminal/model-resolution";
import { AUTO_ACCEPT_FRESH_ONLY_HELP, AUTO_ACCEPT_ON_CONSEQUENCE } from "@/lib/terminal/auto-accept-mode";
import {
  KNOWN_CODEX_MODELS,
  isKnownCodexModel,
  validateReasoningEffort,
  validateCodexModelValue,
  type ReasoningEffort,
} from "@/lib/codex-models";
import { SEED_AGENT_AWARE_PLATFORM_MODEL_DEFAULTS, type AgentAwareUserModelTierMap, type AgentKind, type AgentTierEntry } from "@/lib/platform-model-defaults";
import { EffortSegmentedControl } from "@/components/shared/effort-segmented-control";

// Radix Select can't use "" as an item value, so "follow the platform
// default" uses this sentinel (unset key in the staged map).
const PLATFORM_DEFAULT_VALUE = "__platform_default__";
// Terminal sessions group only: swaps the Select for a free-text Input
// (mirrors the admin platform card's TierModelField "Custom…" escape hatch —
// design handoff note: a novel model family needs no code change here either).
const TERMINAL_CUSTOM_VALUE = "__custom__";
// Codex model column's own "Custom…" escape hatch (same pattern, own sentinel
// so it never collides with the terminal group's).
const CODEX_CUSTOM_VALUE = "__codex_custom__";

const MODEL_OPTIONS: { value: ModelAlias; label: string; gloss: string }[] = [
  { value: "fable", label: "Fable", gloss: "Most capable — frontier reasoning" },
  { value: "opus", label: "Opus", gloss: "Deep reasoning — previous flagship" },
  { value: "sonnet", label: "Sonnet", gloss: "Balanced speed & quality" },
  { value: "haiku", label: "Haiku", gloss: "Fastest & lowest cost" },
];

const TERMINAL_MODEL_OPTIONS = MODEL_OPTIONS.filter((o) =>
  (KNOWN_TERMINAL_MODEL_ALIASES as readonly string[]).includes(o.value)
);

const TIER_FIELDS: { tier: ModelTierValue; label: string }[] = [
  { tier: "frontier", label: "Frontier" },
  { tier: "standard", label: "Standard" },
  { tier: "cheap", label: "Cheap" },
];

const AGENT_LABELS: Record<AgentKind, string> = { claude: "Claude", codex: "Codex" };

interface ModelTierSettingsProps {
  /** The signed-in user's agent-aware model_tier_map override, already
   *  normalized server-side (normalizeUserModelTierMap) — a legacy flat row
   *  upgrades transparently, so this component only ever sees the
   *  agent-aware shape (AC-2 backward compat). */
  agentAwareMap: AgentAwareUserModelTierMap;
  /** The signed-in user's terminal_model override (task c4ca2d95), fetched server-side. */
  terminalModel: string | null;
  terminalCodexModel?: string | null;
  terminalCodexEffort?: string | null;
  /** The signed-in user's terminal_auto_accept preference (task d3de150c), fetched server-side. */
  terminalAutoAccept: boolean;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}

/** True when `value` is a custom (not platform-default, not machine-default,
 *  not a known alias) staged terminal value — i.e. the Select should be
 *  showing the free-text Input instead. */
function isTerminalCustomValue(value: string | null): boolean {
  return value !== null && value !== MACHINE_DEFAULT_TERMINAL_MODEL && !isKnownTerminalModelAlias(value);
}

/**
 * One agent's tier cell: model control (Select for Claude, Select+free-text
 * for Codex) stacked over the effort control (design §1: "every agent cell
 * is a vertical pair"). Choosing a model clears the effort to unset;
 * switching back to Platform default clears both (refines FR-7 — the pair is
 * atomic per agent).
 */
function AgentTierCell({
  tier,
  agent,
  staged,
  platformEntry,
  disabled,
  customMode,
  onToggleCustom,
  onModelChange,
  onEffortChange,
}: {
  tier: ModelTierValue;
  agent: AgentKind;
  staged: Partial<AgentTierEntry> | undefined;
  platformEntry: AgentTierEntry;
  disabled: boolean;
  customMode: boolean;
  onToggleCustom: (custom: boolean) => void;
  onModelChange: (model: string | null) => void;
  onEffortChange: (effort: ReasoningEffort) => void;
}) {
  const idBase = `model-tier-${tier}-${agent}`;
  const errorId = `${idBase}-error`;
  const codexErrorId = `${idBase}-codex-error`;
  const codexNovelId = `${idBase}-codex-novel`;
  const hasOverride = staged?.model !== undefined;
  const missingEffort = hasOverride && staged?.effort === undefined;
  const platformLabel =
    agent === "claude" ? capitalizeModelName(platformEntry.model) : platformEntry.model;

  const codexValidation =
    agent === "codex" && customMode && staged?.model !== undefined
      ? validateCodexModelValue(staged.model)
      : { ok: true as const };
  const codexBlocked = agent === "codex" && customMode && !codexValidation.ok;
  const codexIsNovel =
    agent === "codex" &&
    customMode &&
    codexValidation.ok &&
    staged?.model !== undefined &&
    staged.model.trim().length > 0 &&
    !isKnownCodexModel(staged.model.trim());

  const modelControl =
    agent === "codex" && customMode ? (
      <div className="space-y-1.5">
        <div className="flex flex-wrap items-center gap-2">
          <Input
            id={idBase}
            value={staged?.model ?? ""}
            onChange={(e) => onModelChange(e.target.value)}
            placeholder="e.g. gpt-6-astra"
            disabled={disabled}
            aria-invalid={codexBlocked || undefined}
            aria-describedby={codexBlocked ? codexErrorId : codexIsNovel ? codexNovelId : undefined}
            className={cn(
              "min-w-0 flex-1",
              codexBlocked && "border-rose-500 focus-visible:ring-rose-500/30",
              !codexBlocked && codexIsNovel && "border-amber-500 focus-visible:ring-amber-500/30 dark:border-amber-500"
            )}
          />
          <Button type="button" variant="ghost" size="sm" disabled={disabled} onClick={() => onToggleCustom(false)}>
            Choose known…
          </Button>
        </div>
        {codexBlocked && !codexValidation.ok && (
          <p id={codexErrorId} role="alert" className="flex items-center gap-1.5 text-[11px] text-rose-500">
            <TriangleAlert className="h-3 w-3 shrink-0" />
            {codexValidation.reason}
          </p>
        )}
        {!codexBlocked && codexIsNovel && (
          <p id={codexNovelId} className="flex items-start gap-1.5 text-[11px] text-amber-600 dark:text-amber-500">
            <TriangleAlert className="mt-0.5 h-3 w-3 shrink-0" />
            Not a known Codex family — sent to Codex exactly as typed. If Codex rejects it, the step falls back at
            claim time.
          </p>
        )}
      </div>
    ) : (
      <Select
        value={staged?.model ?? PLATFORM_DEFAULT_VALUE}
        onValueChange={(v) => {
          if (v === CODEX_CUSTOM_VALUE) {
            onToggleCustom(true);
            return;
          }
          onModelChange(v === PLATFORM_DEFAULT_VALUE ? null : v);
        }}
        disabled={disabled}
      >
        <SelectTrigger id={idBase} className="w-full" aria-label={`${AGENT_LABELS[agent]} model — ${tier}`}>
          <SelectValue>
            {hasOverride ? (
              agent === "claude" ? (
                MODEL_OPTIONS.find((m) => m.value === staged?.model)?.label ?? staged?.model
              ) : (
                staged?.model
              )
            ) : (
              <span className="text-muted-foreground">{platformLabel} (default)</span>
            )}
          </SelectValue>
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={PLATFORM_DEFAULT_VALUE}>Platform default ({platformLabel})</SelectItem>
          <SelectSeparator />
          {agent === "claude"
            ? MODEL_OPTIONS.map((opt) => (
                <SelectItem key={opt.value} value={opt.value}>
                  {opt.label} <span className="text-muted-foreground">— {opt.gloss}</span>
                </SelectItem>
              ))
            : KNOWN_CODEX_MODELS.map((opt) => (
                <SelectItem key={opt.value} value={opt.value}>
                  {opt.label}
                </SelectItem>
              ))}
          {agent === "codex" && (
            <>
              <SelectSeparator />
              <SelectItem value={CODEX_CUSTOM_VALUE}>Custom… (type a model id)</SelectItem>
            </>
          )}
        </SelectContent>
      </Select>
    );

  return (
    <div className="min-w-0 space-y-1.5" data-agent={AGENT_LABELS[agent]}>
      {modelControl}
      <div className="space-y-1">
        <span className="block text-[10px] text-muted-foreground">Effort</span>
        <EffortSegmentedControl
          agent={agent}
          value={staged?.effort}
          showDefaultPressed={!hasOverride ? platformEntry.effort : undefined}
          disabled={disabled || !hasOverride}
          onChange={onEffortChange}
          invalid={missingEffort}
          describedById={missingEffort ? errorId : undefined}
        />
      </div>
      {missingEffort && (
        <p id={errorId} role="alert" className="flex items-start gap-1.5 text-[11px] text-rose-500">
          <TriangleAlert className="mt-0.5 h-3 w-3 shrink-0" />
          <span>
            <b>
              Choose a reasoning effort for {agent === "claude" ? capitalizeModelName(staged!.model!) : staged!.model}.
            </b>{" "}
            A model needs an effort — pick Low, Medium or High, or switch the model back to Platform default.
          </span>
        </p>
      )}
    </div>
  );
}

/**
 * "Model tier mapping" settings dialog (own-profile only, FR-13/14, now
 * agent-aware — Codex model-tier task FR-7). Modelled on api-key-settings.tsx:
 * outline trigger → dialog. Save is the only write path — Reset stages an
 * all-cleared map locally, Cancel/Esc discards staged changes.
 *
 * Also houses the "Terminal sessions" group (task c4ca2d95) — Nick's binding
 * approval-gate note: the setting lives HERE, inside this (unrenamed)
 * dialog, rather than a separate settings surface.
 */
export function ModelTierSettings({
  agentAwareMap,
  terminalModel,
  terminalCodexModel = null,
  terminalCodexEffort = null,
  terminalAutoAccept,
  open: controlledOpen,
  onOpenChange: controlledOnOpenChange,
}: ModelTierSettingsProps) {
  const [internalOpen, setInternalOpen] = useState(false);
  const isControlled = controlledOpen !== undefined;
  const open = isControlled ? controlledOpen : internalOpen;
  const setOpen = isControlled ? controlledOnOpenChange! : setInternalOpen;
  const [isPending, startTransition] = useTransition();
  const [staged, setStaged] = useState<AgentAwareUserModelTierMap>(agentAwareMap);
  const [codexCustomFields, setCodexCustomFields] = useState<Record<string, boolean>>({});
  const { defaults: platformDefaults, isLoading: platformLoading } = usePlatformAgentAwareModelDefaults();
  const platformTerminalDefault = usePlatformTerminalModelDefault();
  const platformTerminalCodexDefault = usePlatformTerminalCodexModelDefault();

  // Terminal sessions group state — null = platform default; the sentinel
  // string = "my machine's default"; anything else = a known alias or a
  // custom value (raw, possibly-invalid text while the user is typing).
  const [terminalStaged, setTerminalStaged] = useState<string | null>(terminalModel);
  const [terminalCustomMode, setTerminalCustomMode] = useState(() => isTerminalCustomValue(terminalModel));
  const [terminalCodexStaged, setTerminalCodexStaged] = useState<string | null>(terminalCodexModel);
  const [terminalCodexEffortStaged, setTerminalCodexEffortStaged] = useState<string | null>(terminalCodexEffort);
  // Auto-accept toggle (task d3de150c) — a plain boolean, no custom-mode
  // escape hatch: the only two legal states are on/off (design AC-6 —
  // "no dropdown, no free text, ever").
  const [autoAcceptStaged, setAutoAcceptStaged] = useState(terminalAutoAccept);
  const [savedValues, setSavedValues] = useState({
    agentAwareMap,
    terminalModel,
    terminalCodexModel,
    terminalCodexEffort,
    terminalAutoAccept,
  });

  // Re-stage from the persisted values on every open so a prior Cancel never
  // leaks into the next open.
  function handleOpenChange(next: boolean) {
    if (next) {
      setStaged(savedValues.agentAwareMap);
      setCodexCustomFields({});
      setTerminalStaged(savedValues.terminalModel);
      setTerminalCustomMode(isTerminalCustomValue(savedValues.terminalModel));
      setTerminalCodexStaged(savedValues.terminalCodexModel);
      setTerminalCodexEffortStaged(savedValues.terminalCodexEffort);
      setAutoAcceptStaged(savedValues.terminalAutoAccept);
    }
    setOpen(next);
  }

  const isTierDirty = JSON.stringify(staged) !== JSON.stringify(savedValues.agentAwareMap);
  const isTerminalDirty = terminalStaged !== savedValues.terminalModel;
  const isAutoAcceptDirty = autoAcceptStaged !== savedValues.terminalAutoAccept;
  const isCodexTerminalDirty = terminalCodexStaged !== savedValues.terminalCodexModel || terminalCodexEffortStaged !== savedValues.terminalCodexEffort;
  const isDirty = isTierDirty || isTerminalDirty || isCodexTerminalDirty || isAutoAcceptDirty;
  const hasAnyOverride =
    Object.keys(staged).length > 0 || terminalStaged !== null || terminalCodexStaged !== null || autoAcceptStaged;

  const terminalValidation = terminalCustomMode ? validateTerminalModelValue(terminalStaged ?? "") : { ok: true as const };
  const terminalIsNovel =
    terminalCustomMode && terminalValidation.ok && !isKnownTerminalModelAlias((terminalStaged ?? "").trim());
  const terminalBlocked = terminalCustomMode && !terminalValidation.ok;
  const codexTerminalValidation = terminalCodexStaged && terminalCodexStaged !== MACHINE_DEFAULT_TERMINAL_MODEL
    ? validateCodexModelValue(terminalCodexStaged)
    : { ok: true as const };
  const codexTerminalBlocked = !codexTerminalValidation.ok ||
    (terminalCodexStaged !== null && terminalCodexStaged !== MACHINE_DEFAULT_TERMINAL_MODEL && terminalCodexEffortStaged === null) ||
    (terminalCodexStaged === MACHINE_DEFAULT_TERMINAL_MODEL && terminalCodexEffortStaged !== null);
  const terminalCodexResolution = platformLoading || platformTerminalCodexDefault === undefined ? null : resolveEffectiveTerminalCodexModelWithSource({
    userModel: terminalCodexStaged,
    userEffort: terminalCodexEffortStaged,
    platformPair: platformTerminalCodexDefault,
    fallbackPair: platformDefaults.defaults.standard.codex,
    isValidModel: (model) => validateCodexModelValue(model).ok,
    isValidEffort: (effort) => validateReasoningEffort(effort).ok,
  });

  // AC-3: a tier entry with a model but no effort blocks Save — find the
  // first offender (tier + agent) to name in the Save hint.
  let missingEffortHint: string | null = null;
  for (const { tier, label } of TIER_FIELDS) {
    for (const agent of ["claude", "codex"] as const) {
      const entry = staged[tier]?.[agent];
      if (entry?.model !== undefined && entry?.effort === undefined) {
        missingEffortHint = `Set ${label}'s ${AGENT_LABELS[agent]} effort to enable Save.`;
      }
    }
    if (missingEffortHint) break;
  }

  // A Codex custom (free-text) model must also pass the shell-safety check
  // (FR-1) before Save — same rule as the terminal starting-model field above.
  let codexInvalidHint: string | null = null;
  for (const { tier, label } of TIER_FIELDS) {
    if (!codexCustomFields[tier]) continue;
    const model = staged[tier]?.codex?.model;
    if (model === undefined) continue;
    const validation = validateCodexModelValue(model);
    if (!validation.ok) {
      codexInvalidHint = `${label} (Codex): ${validation.reason}`;
      break;
    }
  }

  const tierBlocked = missingEffortHint !== null || codexInvalidHint !== null;

  function updateAgentEntry(
    tier: ModelTierValue,
    agent: AgentKind,
    entry: Partial<AgentTierEntry> | undefined
  ) {
    setStaged((prev) => {
      const next = { ...prev };
      const tierEntry = { ...(next[tier] ?? {}) };
      if (entry === undefined) {
        delete tierEntry[agent];
      } else {
        tierEntry[agent] = entry;
      }
      if (Object.keys(tierEntry).length > 0) {
        next[tier] = tierEntry;
      } else {
        delete next[tier];
      }
      return next;
    });
  }

  function handleModelChange(tier: ModelTierValue, agent: AgentKind, model: string | null) {
    if (agent === "codex") setCodexCustomFields((prev) => ({ ...prev, [tier]: false }));
    // Choosing a model clears the effort to "unset" (design §1 — the pair is
    // atomic); switching back to Platform default clears the whole entry.
    updateAgentEntry(tier, agent, model === null ? undefined : { model });
  }

  function handleEffortChange(tier: ModelTierValue, agent: AgentKind, effort: ReasoningEffort) {
    const current = staged[tier]?.[agent];
    if (current?.model === undefined) return; // shouldn't happen — effort control is disabled without a model
    updateAgentEntry(tier, agent, { model: current.model, effort });
  }

  function handleTerminalSelectChange(value: string) {
    if (value === TERMINAL_CUSTOM_VALUE) {
      setTerminalCustomMode(true);
      setTerminalStaged((prev) => (isTerminalCustomValue(prev) ? prev : ""));
      return;
    }
    setTerminalCustomMode(false);
    setTerminalStaged(value === PLATFORM_DEFAULT_VALUE ? null : value);
  }

  function handleReset() {
    setStaged({});
    setCodexCustomFields({});
    setTerminalStaged(null);
    setTerminalCustomMode(false);
    setTerminalCodexStaged(null);
    setTerminalCodexEffortStaged(null);
    setAutoAcceptStaged(false);
  }

  function handleSave() {
    if (tierBlocked || terminalBlocked || codexTerminalBlocked) return;
    startTransition(async () => {
      try {
        const terminalToSave = terminalCustomMode ? (terminalStaged ?? "").trim() : terminalStaged;
        const saved = await updateTerminalPreferences({
          agentAwareModelTierMap: staged,
          terminalModel: terminalToSave,
          terminalCodexModel: terminalCodexStaged,
          terminalCodexEffort: terminalCodexStaged === MACHINE_DEFAULT_TERMINAL_MODEL ? null : terminalCodexEffortStaged,
          terminalAutoAccept: autoAcceptStaged,
        });
        setViewerAgentAwareModelTierMapCache(saved.agentAwareModelTierMap ?? {});
        setViewerTerminalModelCache(saved.terminalModel);
        setViewerTerminalAutoAcceptCache(saved.terminalAutoAccept);
        setSavedValues({
          agentAwareMap: saved.agentAwareModelTierMap ?? {},
          terminalModel: saved.terminalModel,
          terminalCodexModel: saved.terminalCodexModel,
          terminalCodexEffort: saved.terminalCodexEffort,
          terminalAutoAccept: saved.terminalAutoAccept,
        });
        toast.success("Model tiers saved");
        setOpen(false);
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Failed to save model tiers — try again");
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      {!isControlled && (
        <DialogTrigger asChild>
          <Button variant="outline" size="sm" className="gap-2">
            <Cpu className="h-4 w-4" />
            Model Tiers
          </Button>
        </DialogTrigger>
      )}
      <DialogContent className="flex max-h-[calc(100dvh-2rem)] flex-col sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Cpu className="h-5 w-5" />
            Model tier mapping
          </DialogTitle>
          <DialogDescription>
            Choose which model and reasoning effort run each workflow tier — for Claude Code and for Codex. Tiers
            you leave unset use the platform default.
          </DialogDescription>
        </DialogHeader>

        <div className="min-h-0 space-y-4 overflow-y-auto py-2 pr-1">
          <div
            className="grid grid-cols-[100px_minmax(0,1fr)_minmax(0,1fr)] gap-x-3 gap-y-3"
            aria-busy={platformLoading || undefined}
            aria-label={platformLoading ? "Loading model tiers" : undefined}
          >
            <div />
            <div className="border-b pb-1 text-xs font-semibold text-muted-foreground">Claude</div>
            <div className="border-b pb-1 text-xs font-semibold text-muted-foreground">Codex</div>

            {TIER_FIELDS.map(({ tier, label }) => {
              const claudeStaged = staged[tier]?.claude;
              const codexStaged = staged[tier]?.codex;
              const claudePlatform = platformDefaults.defaults[tier].claude;
              const codexPlatform = platformDefaults.defaults[tier].codex;
              const claudeEffective: AgentTierEntry = {
                model: claudeStaged?.model ?? claudePlatform.model,
                effort: claudeStaged?.effort ?? claudePlatform.effort,
              };
              const codexEffective: AgentTierEntry = {
                model: codexStaged?.model ?? codexPlatform.model,
                effort: codexStaged?.effort ?? codexPlatform.effort,
              };
              const claudeIncomplete = claudeStaged?.model !== undefined && claudeStaged?.effort === undefined;
              const codexIncomplete = codexStaged?.model !== undefined && codexStaged?.effort === undefined;

              return (
                <div key={tier} className="contents">
                  <div className="pt-1.5">
                    <p className="text-sm font-semibold">{label}</p>
                    <p className="text-[11px] text-muted-foreground">{MODEL_TIER_WHEN_TO_USE[tier]}</p>
                  </div>

                  {platformLoading ? (
                    <>
                      <div className="space-y-1.5">
                        <Skeleton className="h-9 w-full" />
                        <Skeleton className="h-9 w-full" />
                      </div>
                      <div className="space-y-1.5">
                        <Skeleton className="h-9 w-full" />
                        <Skeleton className="h-9 w-full" />
                      </div>
                    </>
                  ) : (
                    <>
                      <AgentTierCell
                        tier={tier}
                        agent="claude"
                        staged={claudeStaged}
                        platformEntry={claudePlatform}
                        disabled={isPending}
                        customMode={false}
                        onToggleCustom={() => {}}
                        onModelChange={(m) => handleModelChange(tier, "claude", m)}
                        onEffortChange={(e) => handleEffortChange(tier, "claude", e)}
                      />
                      <AgentTierCell
                        tier={tier}
                        agent="codex"
                        staged={codexStaged}
                        platformEntry={codexPlatform}
                        disabled={isPending}
                        customMode={codexCustomFields[tier] ?? false}
                        onToggleCustom={(c) => setCodexCustomFields((prev) => ({ ...prev, [tier]: c }))}
                        onModelChange={(m) => handleModelChange(tier, "codex", m)}
                        onEffortChange={(e) => handleEffortChange(tier, "codex", e)}
                      />
                    </>
                  )}

                  <div className="col-span-3 border-b border-dashed pb-2 text-[11px] text-muted-foreground">
                    {platformLoading ? (
                      <Skeleton className="h-3 w-1/2" />
                    ) : claudeIncomplete || codexIncomplete ? (
                      <>
                        {label} → {claudeIncomplete ? (
                          <b className="text-muted-foreground">
                            {capitalizeModelName(claudeStaged!.model!)} (effort not set)
                          </b>
                        ) : (
                          <b className="text-foreground">
                            {capitalizeModelName(claudeEffective.model)} ({claudeEffective.effort})
                          </b>
                        )}{" "}
                        on Claude ·{" "}
                        {codexIncomplete ? (
                          <b className="text-muted-foreground">{codexStaged!.model} (effort not set)</b>
                        ) : (
                          <b className="text-foreground">
                            {codexEffective.model} ({codexEffective.effort})
                          </b>
                        )}{" "}
                        on Codex
                      </>
                    ) : (
                      tierResolutionLine(tier, claudeEffective, codexEffective)
                    )}
                  </div>
                </div>
              );
            })}
          </div>
          <p className="text-[11px] text-muted-foreground">
            Workflow steps with a tier run on that tier&apos;s model and effort for whichever agent claims the step.
            Live sessions pick up a change on their next step — a step already running finishes on what it started
            with. If a model isn&apos;t available, the orchestrator substitutes that tier&apos;s fallback and notes
            it in the step output.
          </p>

          {/* Terminal sessions group (task c4ca2d95) — the setting stays inside
              this dialog per Nick's binding approval-gate note (no rename, no
              separate settings surface). */}
          <p className="pt-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            Terminal sessions
          </p>
          <div className="space-y-1.5">
            <Label htmlFor="terminal-starting-model" className="text-sm">
              Starting model{" "}
              <span className="font-normal text-muted-foreground">— for new in-browser Claude Code sessions</span>
            </Label>
            {terminalCustomMode ? (
              <div className="flex flex-wrap items-center gap-2">
                <Input
                  id="terminal-starting-model"
                  value={terminalStaged ?? ""}
                  onChange={(e) => setTerminalStaged(e.target.value)}
                  placeholder="e.g. opus-5.5"
                  disabled={isPending}
                  aria-invalid={terminalBlocked}
                  aria-describedby={
                    terminalBlocked
                      ? "terminal-model-error"
                      : terminalIsNovel
                        ? "terminal-model-novel-warning"
                        : undefined
                  }
                  className={cn(
                    "min-w-[10rem] flex-1",
                    terminalBlocked && "border-rose-500 focus-visible:ring-rose-500/30",
                    !terminalBlocked && terminalIsNovel && "border-amber-500 focus-visible:ring-amber-500/30 dark:border-amber-500"
                  )}
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled={isPending}
                  onClick={() => {
                    setTerminalCustomMode(false);
                    setTerminalStaged(null);
                  }}
                >
                  Choose known…
                </Button>
              </div>
            ) : (
              <Select value={terminalStaged ?? PLATFORM_DEFAULT_VALUE} onValueChange={handleTerminalSelectChange} disabled={isPending}>
                <SelectTrigger id="terminal-starting-model" aria-describedby="terminal-model-help" className="w-full">
                  <SelectValue>
                    {terminalStaged === null ? (
                      <span className="text-muted-foreground">
                        Platform default
                        {platformTerminalDefault ? ` (${capitalizeTerminalModelName(platformTerminalDefault)})` : " (your machine decides)"}
                      </span>
                    ) : terminalStaged === MACHINE_DEFAULT_TERMINAL_MODEL ? (
                      "My machine's default"
                    ) : (
                      TERMINAL_MODEL_OPTIONS.find((o) => o.value === terminalStaged)?.label ?? terminalStaged
                    )}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={PLATFORM_DEFAULT_VALUE}>
                    Platform default
                    {platformTerminalDefault ? ` (${capitalizeTerminalModelName(platformTerminalDefault)})` : " (your machine decides)"}
                  </SelectItem>
                  <SelectItem value={MACHINE_DEFAULT_TERMINAL_MODEL}>My machine&apos;s default</SelectItem>
                  <SelectSeparator />
                  {TERMINAL_MODEL_OPTIONS.map((opt) => (
                    <SelectItem key={opt.value} value={opt.value}>
                      {opt.label} <span className="text-muted-foreground">— {opt.gloss}</span>
                    </SelectItem>
                  ))}
                  <SelectSeparator />
                  <SelectItem value={TERMINAL_CUSTOM_VALUE}>Custom… (type an alias or model id)</SelectItem>
                </SelectContent>
              </Select>
            )}
            {terminalBlocked && !terminalValidation.ok && (
              <p id="terminal-model-error" role="alert" className="flex items-center gap-1.5 text-xs text-rose-500">
                <TriangleAlert className="h-3.5 w-3.5 shrink-0" />
                {terminalValidation.reason}
              </p>
            )}
            {!terminalBlocked && terminalIsNovel && (
              <p id="terminal-model-novel-warning" className="flex items-start gap-1.5 text-xs text-amber-600 dark:text-amber-500">
                <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                Not a known family alias — it&apos;s passed to Claude Code exactly as typed. If Claude rejects it, the
                error appears in the terminal when the session starts; fix it here.
              </p>
            )}
            {!terminalCustomMode && (
              <p id="terminal-model-help" className="text-[11px] text-muted-foreground">
                Applies to new Claude Code sessions. Choose the Codex starting model below. Resumed sessions
                keep their existing model; you can switch any time by typing /model in the terminal.
              </p>
            )}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="terminal-codex-starting-model" className="text-sm">
              Codex starting model <span className="font-normal text-muted-foreground">— for new in-browser Codex sessions</span>
            </Label>
            <Select value={terminalCodexStaged ?? PLATFORM_DEFAULT_VALUE} onValueChange={(value) => {
              if (value === PLATFORM_DEFAULT_VALUE) { setTerminalCodexStaged(null); setTerminalCodexEffortStaged(null); }
              else if (value === MACHINE_DEFAULT_TERMINAL_MODEL) { setTerminalCodexStaged(value); setTerminalCodexEffortStaged(null); }
              else { setTerminalCodexStaged(value); if (!terminalCodexEffortStaged) setTerminalCodexEffortStaged("medium"); }
            }} disabled={isPending}>
              <SelectTrigger id="terminal-codex-starting-model" className="w-full"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value={PLATFORM_DEFAULT_VALUE}>Use organization default</SelectItem>
                <SelectItem value={MACHINE_DEFAULT_TERMINAL_MODEL}>My machine&apos;s default</SelectItem>
                <SelectSeparator />
                {KNOWN_CODEX_MODELS.map((option) => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}
              </SelectContent>
            </Select>
            {terminalCodexStaged !== null && terminalCodexStaged !== MACHINE_DEFAULT_TERMINAL_MODEL && (
              <EffortSegmentedControl
                agent="codex"
                value={(terminalCodexEffortStaged ?? "medium") as ReasoningEffort}
                onChange={(effort) => setTerminalCodexEffortStaged(effort)}
                disabled={isPending}
              />
            )}
            {codexTerminalBlocked && <p role="alert" className="flex items-center gap-1.5 text-xs text-rose-500"><TriangleAlert className="h-3.5 w-3.5 shrink-0" />Choose a valid Codex model and reasoning effort.</p>}
            <p className="text-[11px] text-muted-foreground">
              {terminalCodexResolution === null
                ? "Checking the Codex terminal default…"
                : terminalCodexResolution.source === "machine"
                  ? "Your machine decides the Codex model and effort."
                  : terminalCodexResolution.pair === undefined
                  ? "No valid Codex terminal default is available"
                  : `${terminalCodexResolution.source === "user" ? "Your saved Codex pair" : terminalCodexResolution.source === "platform" ? "Organization Codex terminal pair" : "Standard Codex fallback"}: ${terminalCodexResolution.pair.model} (${terminalCodexResolution.pair.effort}).`}
              {" "}Resumed sessions keep their existing model.
            </p>
          </div>

          {/* Auto-accept toggle (task d3de150c "Terminal mode") — a two-state
              Switch, never a dropdown or free text: the only value this can
              ever produce is the literal "auto" or nothing (AC-6).
              No platform-wide default exists for this — per-user only. */}
          <div className="space-y-1.5">
            <div className="flex items-start justify-between gap-3">
              <Label htmlFor="terminal-auto-accept" className="text-sm font-normal">
                Start in auto mode
              </Label>
              <Switch
                id="terminal-auto-accept"
                checked={autoAcceptStaged}
                onCheckedChange={setAutoAcceptStaged}
                disabled={isPending}
                aria-describedby="terminal-auto-accept-help"
              />
            </div>
            <p
              id="terminal-auto-accept-help"
              className={cn("text-[11px]", autoAcceptStaged ? "text-amber-600 dark:text-amber-500" : "text-muted-foreground")}
            >
              {autoAcceptStaged ? AUTO_ACCEPT_ON_CONSEQUENCE : AUTO_ACCEPT_FRESH_ONLY_HELP}
            </p>
          </div>
        </div>

        <DialogFooter className="gap-2 sm:gap-0">
          <Button
            variant="ghost"
            size="sm"
            onClick={handleReset}
            disabled={isPending || !hasAnyOverride}
          >
            Reset to defaults
          </Button>
          <div className="flex flex-1 justify-end gap-2">
            <Button variant="outline" size="sm" onClick={() => handleOpenChange(false)} disabled={isPending}>
              Cancel
            </Button>
            <Button
              size="sm"
              onClick={handleSave}
              disabled={isPending || !isDirty || terminalBlocked || codexTerminalBlocked || tierBlocked}
              aria-describedby={!isDirty || terminalBlocked || codexTerminalBlocked || tierBlocked ? "model-tier-save-why" : undefined}
            >
              {isPending ? "Saving…" : "Save"}
            </Button>
          </div>
        </DialogFooter>
        {tierBlocked ? (
          <p id="model-tier-save-why" className="-mt-2 text-right text-[11px] text-muted-foreground">
            {missingEffortHint ?? codexInvalidHint}
          </p>
        ) : terminalBlocked ? (
          <p id="model-tier-save-why" className="-mt-2 text-right text-[11px] text-muted-foreground">
            Fix the starting model to enable Save.
          </p>
        ) : codexTerminalBlocked ? (
          <p id="model-tier-save-why" className="-mt-2 text-right text-[11px] text-muted-foreground">Fix the Codex starting model to enable Save.</p>
        ) : (
          !isDirty && (
            <p id="model-tier-save-why" className="-mt-2 text-right text-[11px] text-muted-foreground">
              Save enables when you change a setting.
            </p>
          )
        )}
      </DialogContent>
    </Dialog>
  );
}
