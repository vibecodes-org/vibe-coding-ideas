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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { updateModelTierMap, updateTerminalModel, updateTerminalAutoAccept } from "@/actions/profile";
import { setViewerModelTierMapCache } from "@/hooks/use-viewer-model-tier-map";
import { setViewerTerminalModelCache } from "@/hooks/use-viewer-terminal-model";
import { setViewerTerminalAutoAcceptCache } from "@/hooks/use-viewer-terminal-auto-accept";
import { usePlatformModelDefaults } from "@/hooks/use-platform-model-defaults";
import { usePlatformTerminalModelDefault } from "@/hooks/use-platform-terminal-model-default";
import {
  MODEL_TIER_WHEN_TO_USE,
  capitalizeModelName,
  type ModelAlias,
  type ModelTierMap,
  type ModelTierValue,
} from "@/lib/constants";
import {
  MACHINE_DEFAULT_TERMINAL_MODEL,
  KNOWN_TERMINAL_MODEL_ALIASES,
  isKnownTerminalModelAlias,
  validateTerminalModelValue,
  capitalizeTerminalModelName,
} from "@/lib/terminal/model-resolution";
import { AUTO_ACCEPT_FRESH_ONLY_HELP, AUTO_ACCEPT_ON_CONSEQUENCE } from "@/lib/terminal/auto-accept-mode";

// Radix Select can't use "" as an item value, so "follow the platform
// default" uses this sentinel (unset key in the stored map).
const PLATFORM_DEFAULT_VALUE = "__platform_default__";
// Terminal sessions group only: swaps the Select for a free-text Input
// (mirrors the admin platform card's TierModelField "Custom…" escape hatch —
// design handoff note: a novel model family needs no code change here either).
const TERMINAL_CUSTOM_VALUE = "__custom__";

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

interface ModelTierSettingsProps {
  /** The signed-in user's model_tier_map, fetched server-side (like hasKey). */
  map: ModelTierMap | null;
  /** The signed-in user's terminal_model override (task c4ca2d95), fetched server-side. */
  terminalModel: string | null;
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
 * "Model tier mapping" settings dialog (own-profile only, FR-13/14). Modelled
 * on api-key-settings.tsx: outline trigger → sm:max-w-md dialog. Save is the
 * only write path — Reset stages an all-cleared map locally, Cancel/Esc
 * discards staged changes (Design §02/§03).
 *
 * Also houses the "Terminal sessions" group (task c4ca2d95) — Nick's binding
 * approval-gate note: the setting lives HERE, inside this (unrenamed)
 * dialog, rather than a separate settings surface.
 */
export function ModelTierSettings({
  map,
  terminalModel,
  terminalAutoAccept,
  open: controlledOpen,
  onOpenChange: controlledOnOpenChange,
}: ModelTierSettingsProps) {
  const [internalOpen, setInternalOpen] = useState(false);
  const isControlled = controlledOpen !== undefined;
  const open = isControlled ? controlledOpen : internalOpen;
  const setOpen = isControlled ? controlledOnOpenChange! : setInternalOpen;
  const [isPending, startTransition] = useTransition();
  const [staged, setStaged] = useState<ModelTierMap>(map ?? {});
  const platformDefaults = usePlatformModelDefaults();
  const platformTerminalDefault = usePlatformTerminalModelDefault();

  // Terminal sessions group state — null = platform default; the sentinel
  // string = "my machine's default"; anything else = a known alias or a
  // custom value (raw, possibly-invalid text while the user is typing).
  const [terminalStaged, setTerminalStaged] = useState<string | null>(terminalModel);
  const [terminalCustomMode, setTerminalCustomMode] = useState(() => isTerminalCustomValue(terminalModel));
  // Auto-accept toggle (task d3de150c) — a plain boolean, no custom-mode
  // escape hatch: the only two legal states are on/off (design §0, AC-6 —
  // "no dropdown, no free text, ever").
  const [autoAcceptStaged, setAutoAcceptStaged] = useState(terminalAutoAccept);

  // Re-stage from the persisted values on every open so a prior Cancel never
  // leaks into the next open.
  function handleOpenChange(next: boolean) {
    if (next) {
      setStaged(map ?? {});
      setTerminalStaged(terminalModel);
      setTerminalCustomMode(isTerminalCustomValue(terminalModel));
      setAutoAcceptStaged(terminalAutoAccept);
    }
    setOpen(next);
  }

  const isTierDirty = TIER_FIELDS.some(
    ({ tier }) => (staged[tier] ?? null) !== (map?.[tier] ?? null)
  );
  const isTerminalDirty = terminalStaged !== terminalModel;
  const isAutoAcceptDirty = autoAcceptStaged !== terminalAutoAccept;
  const isDirty = isTierDirty || isTerminalDirty || isAutoAcceptDirty;
  const hasAnyOverride =
    TIER_FIELDS.some(({ tier }) => staged[tier] !== undefined) || terminalStaged !== null || autoAcceptStaged;

  const terminalValidation = terminalCustomMode ? validateTerminalModelValue(terminalStaged ?? "") : { ok: true as const };
  const terminalIsNovel =
    terminalCustomMode && terminalValidation.ok && !isKnownTerminalModelAlias((terminalStaged ?? "").trim());
  const terminalBlocked = terminalCustomMode && !terminalValidation.ok;

  function handleTierChange(tier: ModelTierValue, value: string) {
    setStaged((prev) => {
      const next = { ...prev };
      if (value === PLATFORM_DEFAULT_VALUE) delete next[tier];
      else next[tier] = value;
      return next;
    });
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
    setTerminalStaged(null);
    setTerminalCustomMode(false);
    setAutoAcceptStaged(false);
  }

  function handleSave() {
    startTransition(async () => {
      try {
        const terminalToSave = terminalCustomMode ? (terminalStaged ?? "").trim() : terminalStaged;
        const [savedTiers, savedTerminal, savedAutoAccept] = await Promise.all([
          updateModelTierMap(staged),
          updateTerminalModel(terminalToSave),
          updateTerminalAutoAccept(autoAcceptStaged),
        ]);
        setViewerModelTierMapCache(savedTiers);
        setViewerTerminalModelCache(savedTerminal);
        setViewerTerminalAutoAcceptCache(savedAutoAccept);
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
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Cpu className="h-5 w-5" />
            Model tier mapping
          </DialogTitle>
          <DialogDescription>
            Choose which Claude model runs each workflow tier. Tiers you leave unset use the platform default.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {TIER_FIELDS.map(({ tier, label }) => {
            const selectValue = staged[tier] ?? PLATFORM_DEFAULT_VALUE;
            const platformLabel = capitalizeModelName(platformDefaults.defaults[tier]);
            const selectedOption = MODEL_OPTIONS.find((m) => m.value === staged[tier]);
            const triggerId = `model-tier-map-${tier}`;

            return (
              <div key={tier} className="space-y-1.5">
                <Label htmlFor={triggerId} className="text-sm">
                  {label}{" "}
                  <span className="font-normal text-muted-foreground">— {MODEL_TIER_WHEN_TO_USE[tier]}</span>
                </Label>
                <Select
                  value={selectValue}
                  onValueChange={(v) => handleTierChange(tier, v)}
                  disabled={isPending}
                >
                  <SelectTrigger id={triggerId} aria-describedby="model-tier-fallback-help" className="w-full">
                    <SelectValue>
                      {selectedOption ? (
                        selectedOption.label
                      ) : (
                        <span className="text-muted-foreground">{platformLabel} (default)</span>
                      )}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={PLATFORM_DEFAULT_VALUE}>
                      Platform default ({platformLabel})
                    </SelectItem>
                    <SelectSeparator />
                    {MODEL_OPTIONS.map((opt) => (
                      <SelectItem key={opt.value} value={opt.value}>
                        {opt.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            );
          })}
          <p id="model-tier-fallback-help" className="text-[11px] text-muted-foreground">
            Workflow steps with a tier run on that tier&apos;s model. If a model isn&apos;t available on your plan
            or session, the orchestrator substitutes the closest available alternative and notes it in the step
            output.
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
              <span className="font-normal text-muted-foreground">— for new in-browser terminal sessions</span>
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
                Applies when a fresh session starts. Resumed sessions keep the model they were on; you can switch
                any time by typing /model in the terminal.
              </p>
            )}
          </div>

          {/* Auto-accept toggle (task d3de150c "Terminal mode") — a two-state
              Switch, never a dropdown or free text: the only value this can
              ever produce is the literal "acceptEdits" or nothing (AC-6).
              No platform-wide default exists for this — per-user only. */}
          <div className="space-y-1.5">
            <div className="flex items-start justify-between gap-3">
              <Label htmlFor="terminal-auto-accept" className="text-sm font-normal">
                Start in auto-accept mode
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
              disabled={isPending || !isDirty || terminalBlocked}
              aria-describedby={!isDirty || terminalBlocked ? "model-tier-save-why" : undefined}
            >
              {isPending ? "Saving…" : "Save"}
            </Button>
          </div>
        </DialogFooter>
        {terminalBlocked ? (
          <p id="model-tier-save-why" className="-mt-2 text-right text-[11px] text-muted-foreground">
            Fix the starting model to enable Save.
          </p>
        ) : (
          !isDirty && (
            <p id="model-tier-save-why" className="-mt-2 text-right text-[11px] text-muted-foreground">
              Save enables when you change a tier.
            </p>
          )
        )}
      </DialogContent>
    </Dialog>
  );
}
