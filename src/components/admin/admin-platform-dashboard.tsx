"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Lock, TriangleAlert } from "lucide-react";
import { cn, formatRelativeTime } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  getPlatformTerminalModelDefaultForAdmin,
  updatePlatformTerminalModelDefault,
  getAgentAwarePlatformModelDefaultsForAdmin,
  updateAgentAwarePlatformModelDefaults,
  type PlatformTerminalModelAudit,
  type AgentAwarePlatformModelDefaultsAudit,
  getPlatformTerminalCodexModelDefaultForAdmin,
  updatePlatformTerminalCodexModelDefault,
  type PlatformTerminalCodexModelAudit,
  getPlatformTerminalEffortDefaultForAdmin,
  updatePlatformTerminalEffortDefault,
  type PlatformTerminalEffortAudit,
  getPlatformTerminalAutoCompactDefaultForAdmin,
  updatePlatformTerminalAutoCompactDefault,
  type PlatformTerminalAutoCompactAudit,
} from "@/actions/admin-platform";
import { setPlatformAgentAwareModelDefaultsCache } from "@/hooks/use-platform-model-defaults";
import { setPlatformTerminalModelDefaultCache } from "@/hooks/use-platform-terminal-model-default";
import { setPlatformTerminalEffortDefaultCache } from "@/hooks/use-platform-terminal-effort-default";
import { EFFORT_LABELS, isClaudeEffort } from "@/lib/terminal/claude-effort";
import { setPlatformTerminalAutoCompactDefaultCache } from "@/hooks/use-platform-terminal-auto-compact-default";
import {
  AUTO_COMPACT_OWN_SIZE_TEXT,
  autoCompactShortLabel,
  isAutoCompactStep,
} from "@/lib/terminal/auto-compact";
import { setPlatformTerminalCodexModelDefaultCache } from "@/hooks/use-platform-terminal-codex-model-default";
import {
  SEED_AGENT_AWARE_PLATFORM_MODEL_DEFAULTS,
  type AgentAwarePlatformModelDefaults,
  type AgentTierEntry,
  type AgentKind,
} from "@/lib/platform-model-defaults";
import { MODEL_TIER_WHEN_TO_USE, capitalizeModelName, tierResolutionLine, type ModelTierValue } from "@/lib/constants";
import { validateTerminalModelValue, capitalizeTerminalModelName } from "@/lib/terminal/model-resolution";
import { KNOWN_CODEX_MODELS, isKnownCodexModel, validateCodexModelValue, type ReasoningEffort } from "@/lib/codex-models";
import { AutoCompactSegmentedControl, EffortSegmentedControl } from "@/components/shared/effort-segmented-control";

// The 4 aliases the per-user Models dialog already offers (model-tier-settings.tsx's
// MODEL_OPTIONS) — "known" here means "selectable with one tap, no typo-guard needed".
const KNOWN_MODEL_OPTIONS = [
  { value: "fable", label: "Fable", gloss: "Most capable — frontier reasoning" },
  { value: "opus", label: "Opus", gloss: "Deep reasoning — previous flagship" },
  { value: "sonnet", label: "Sonnet", gloss: "Balanced speed & quality" },
  { value: "haiku", label: "Haiku", gloss: "Fastest & lowest cost" },
] as const;
const KNOWN_MODEL_VALUES = new Set<string>(KNOWN_MODEL_OPTIONS.map((o) => o.value));

const CUSTOM_VALUE = "__custom__";

const TIER_FIELDS: { tier: ModelTierValue; label: string }[] = [
  { tier: "frontier", label: "Frontier" },
  { tier: "standard", label: "Standard" },
  { tier: "cheap", label: "Cheap" },
];

// Fixed set of fallback rows (Panel B) — mirrors the seed's alias/model-keyed
// chain per agent. The fallback map is keyed by resolved MODEL, not by tier
// (Design-Review discrepancy note in docs/design-platform-model-defaults.html)
// — editing a 5th row for a brand-new family is a follow-up, not this MVP.
// The fallback shape (AgentAwarePlatformModelDefaults["fallback"]) carries no
// effort field — only the tier defaults (Panel A) do — so fallback rows are
// model-only, same as the pre-agent-aware UI; this is a deliberate deviation
// from the mockup's fallback-effort-pair illustration, constrained by the
// already-built resolution type shared with mcp-server.
const FALLBACK_ROWS_CLAUDE = ["fable", "opus", "sonnet", "haiku"] as const;
const FALLBACK_ROWS_CODEX = KNOWN_CODEX_MODELS.map((m) => m.value);

const AGENT_LABELS: Record<AgentKind, string> = { claude: "Claude", codex: "Codex" };

type StagedState = AgentAwarePlatformModelDefaults;

function stateEquals(a: StagedState, b: StagedState): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

function allStagedModelValues(state: StagedState): { agent: AgentKind; value: string }[] {
  const values: { agent: AgentKind; value: string }[] = [];
  for (const tier of ["frontier", "standard", "cheap"] as const) {
    values.push({ agent: "claude", value: state.defaults[tier].claude.model });
    values.push({ agent: "codex", value: state.defaults[tier].codex.model });
  }
  for (const v of Object.values(state.fallback.claude)) values.push({ agent: "claude", value: v });
  for (const v of Object.values(state.fallback.codex)) values.push({ agent: "codex", value: v });
  return values;
}

function isKnownAgentModel(agent: AgentKind, value: string): boolean {
  return agent === "claude" ? KNOWN_MODEL_VALUES.has(value) : isKnownCodexModel(value);
}

/** One tier-default or fallback-chain model field, agent-aware: a known
 *  Select (Claude aliases, or the Codex model catalogue) with a "Custom…"
 *  escape hatch that swaps to a free-text Input (novel model family, no
 *  schema change). Codex custom values are also shell-safety validated
 *  (FR-1) — a structural error blocks Save independently of the novel-value
 *  confirm checkbox. */
function AgentModelField({
  id,
  agent,
  label,
  value,
  onChange,
  forceCustom,
  onToggleCustom,
  disabled,
}: {
  id: string;
  agent: AgentKind;
  label: string;
  value: string;
  onChange: (v: string) => void;
  forceCustom: boolean;
  onToggleCustom: (custom: boolean) => void;
  disabled: boolean;
}) {
  const isCustom = forceCustom || (value.length > 0 && !isKnownAgentModel(agent, value));
  const isNovel = value.trim().length > 0 && !isKnownAgentModel(agent, value);
  const codexValidation = agent === "codex" && isCustom ? validateCodexModelValue(value) : { ok: true as const };
  const codexBlocked = agent === "codex" && isCustom && !codexValidation.ok;

  return (
    <div className="space-y-1.5">
      <Label htmlFor={id} className="text-xs">
        {label}
      </Label>
      {isCustom ? (
        <div className="flex flex-wrap items-center gap-2">
          <Input
            id={id}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            placeholder={agent === "claude" ? "e.g. opus-5.5" : "e.g. gpt-6-astra"}
            disabled={disabled}
            aria-invalid={codexBlocked || undefined}
            aria-describedby={codexBlocked ? `${id}-error` : isNovel ? `${id}-novel-warning` : undefined}
            className={cn(
              "min-w-[10rem] flex-1",
              codexBlocked && "border-rose-500 focus-visible:ring-rose-500/30",
              !codexBlocked && isNovel && "border-amber-500 focus-visible:ring-amber-500/30 dark:border-amber-500"
            )}
          />
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={disabled}
            onClick={() => onToggleCustom(false)}
          >
            Choose known…
          </Button>
        </div>
      ) : (
        <Select
          value={value}
          disabled={disabled}
          onValueChange={(v) => {
            if (v === CUSTOM_VALUE) {
              onToggleCustom(true);
            } else {
              onToggleCustom(false);
              onChange(v);
            }
          }}
        >
          <SelectTrigger id={id} className="w-full">
            <SelectValue>
              {agent === "claude"
                ? KNOWN_MODEL_OPTIONS.find((o) => o.value === value)?.label ?? value
                : KNOWN_CODEX_MODELS.find((o) => o.value === value)?.label ?? value}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            {agent === "claude"
              ? KNOWN_MODEL_OPTIONS.map((o) => (
                  <SelectItem key={o.value} value={o.value}>
                    {o.label} <span className="text-muted-foreground">— {o.gloss}</span>
                  </SelectItem>
                ))
              : KNOWN_CODEX_MODELS.map((o) => (
                  <SelectItem key={o.value} value={o.value}>
                    {o.label}
                  </SelectItem>
                ))}
            <SelectItem value={CUSTOM_VALUE}>Custom… (type a new family)</SelectItem>
          </SelectContent>
        </Select>
      )}
      {codexBlocked && !codexValidation.ok && (
        <p id={`${id}-error`} role="alert" className="flex items-center gap-1.5 text-xs text-rose-500">
          <TriangleAlert className="h-3.5 w-3.5 shrink-0" />
          {codexValidation.reason}
        </p>
      )}
    </div>
  );
}

/** One tier default's agent cell (Panel A): AgentModelField stacked over the
 *  reasoning-effort segmented control — the same vertical-pair shape as the
 *  Profile dialog's agent-aware grid (design §2: "the same grid as Profile,
 *  on purpose"). */
function AgentTierDefaultCell({
  tier,
  agent,
  entry,
  onModelChange,
  onEffortChange,
  forceCustom,
  onToggleCustom,
  disabled,
}: {
  tier: ModelTierValue;
  agent: AgentKind;
  entry: AgentTierEntry;
  onModelChange: (model: string) => void;
  onEffortChange: (effort: ReasoningEffort) => void;
  forceCustom: boolean;
  onToggleCustom: (custom: boolean) => void;
  disabled: boolean;
}) {
  return (
    <div className="space-y-1.5">
      <AgentModelField
        id={`platform-default-${tier}-${agent}`}
        agent={agent}
        label={`${AGENT_LABELS[agent]} model`}
        value={entry.model}
        onChange={onModelChange}
        forceCustom={forceCustom}
        onToggleCustom={onToggleCustom}
        disabled={disabled}
      />
      <div className="space-y-1">
        <span className="block text-[10px] text-muted-foreground">Effort</span>
        <EffortSegmentedControl agent={agent} value={entry.effort} disabled={disabled} onChange={onEffortChange} />
      </div>
    </div>
  );
}

function PlatformAccessDenied() {
  return (
    <div className="rounded-lg border p-10 text-center">
      <Lock className="mx-auto mb-3 h-6 w-6 text-muted-foreground" />
      <p className="mb-1 font-semibold">Super-admin access required</p>
      <p className="text-sm text-muted-foreground">
        Platform model defaults can only be changed by super-admins.
      </p>
    </div>
  );
}

/**
 * Super-admin-only "Platform" tab (docs/design-platform-model-defaults.html) —
 * Panel A (per-tier platform defaults) + Panel B (alias fallback chain).
 * Self-fetches via a server action (mirrors TierAdherenceDashboard's pattern)
 * rather than the page-level SSR prop pattern the rest of /admin uses, so
 * this card gets its own genuine loading/error states. The server action
 * independently re-checks is_super_admin on save (defence in depth) — the
 * `isSuperAdmin` prop here only controls what this tab RENDERS.
 */
export function AdminPlatformDashboard({ isSuperAdmin }: { isSuperAdmin: boolean }) {
  const [loadState, setLoadState] = useState<"loading" | "error" | "ready">("loading");
  const [reloadToken, setReloadToken] = useState(0);
  const [audit, setAudit] = useState<AgentAwarePlatformModelDefaultsAudit | null>(null);
  const [persisted, setPersisted] = useState<StagedState>(SEED_AGENT_AWARE_PLATFORM_MODEL_DEFAULTS);
  const [staged, setStaged] = useState<StagedState>(SEED_AGENT_AWARE_PLATFORM_MODEL_DEFAULTS);
  const [customFields, setCustomFields] = useState<Record<string, boolean>>({});
  const [confirmedNovel, setConfirmedNovel] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!isSuperAdmin) return;
    let cancelled = false;
    setLoadState("loading");
    getAgentAwarePlatformModelDefaultsForAdmin()
      .then((result) => {
        if (cancelled) return;
        setAudit(result);
        setPersisted(result.value);
        setStaged(result.value);
        setLoadState("ready");
      })
      .catch(() => {
        if (cancelled) return;
        setLoadState("error");
      });
    return () => {
      cancelled = true;
    };
  }, [isSuperAdmin, reloadToken]);

  if (!isSuperAdmin) return <PlatformAccessDenied />;

  if (loadState === "loading") {
    return (
      <div className="space-y-4 rounded-lg border p-6">
        <Skeleton className="h-5 w-48" />
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Skeleton className="h-4 w-20" />
            <Skeleton className="h-9 w-full" />
          </div>
        ))}
      </div>
    );
  }

  if (loadState === "error") {
    return (
      <div className="rounded-lg border border-red-500/20 bg-red-500/5 p-6 text-center">
        <p className="text-sm text-red-400">Failed to load platform model defaults.</p>
        <Button size="sm" variant="outline" className="mt-3" onClick={() => setReloadToken((t) => t + 1)}>
          Retry
        </Button>
      </div>
    );
  }

  const isDirty = !stateEquals(staged, persisted);
  const hasNovelValue = allStagedModelValues(staged).some(
    ({ agent, value }) => value.trim().length > 0 && !isKnownAgentModel(agent, value)
  );
  const hasBlockedCodexValue = allStagedModelValues(staged).some(
    ({ agent, value }) => agent === "codex" && !validateCodexModelValue(value).ok
  );
  const saveDisabled = saving || !isDirty || hasBlockedCodexValue || (hasNovelValue && !confirmedNovel);

  function setFieldCustom(id: string, custom: boolean) {
    setCustomFields((prev) => ({ ...prev, [id]: custom }));
  }

  function handleDefaultModelChange(tier: ModelTierValue, agent: AgentKind, model: string) {
    setStaged((prev) => ({
      ...prev,
      defaults: {
        ...prev.defaults,
        [tier]: { ...prev.defaults[tier], [agent]: { ...prev.defaults[tier][agent], model } },
      },
    }));
  }

  function handleDefaultEffortChange(tier: ModelTierValue, agent: AgentKind, effort: ReasoningEffort) {
    setStaged((prev) => ({
      ...prev,
      defaults: {
        ...prev.defaults,
        [tier]: { ...prev.defaults[tier], [agent]: { ...prev.defaults[tier][agent], effort } },
      },
    }));
  }

  function handleFallbackChange(agent: AgentKind, key: string, value: string) {
    setStaged((prev) => ({
      ...prev,
      fallback: { ...prev.fallback, [agent]: { ...prev.fallback[agent], [key]: value } },
    }));
  }

  function handleCancel() {
    setStaged(persisted);
    setCustomFields({});
    setConfirmedNovel(false);
  }

  function handleResetToSeed() {
    // Local staging only — like the per-user Models dialog's "Reset to
    // defaults", this doesn't persist until Save is clicked. "(both agents)"
    // in the button label (AC-4) so nobody expects a Claude-only reset.
    setStaged(SEED_AGENT_AWARE_PLATFORM_MODEL_DEFAULTS);
    setCustomFields({});
    setConfirmedNovel(false);
  }

  async function handleSave() {
    setSaving(true);
    try {
      await updateAgentAwarePlatformModelDefaults(staged);
      const fresh = await getAgentAwarePlatformModelDefaultsForAdmin();
      setAudit(fresh);
      setPersisted(fresh.value);
      setStaged(fresh.value);
      setCustomFields({});
      setConfirmedNovel(false);
      setPlatformAgentAwareModelDefaultsCache(fresh.value);
      const frontier = fresh.value.defaults.frontier;
      toast.success(
        `Model tier defaults saved · frontier now runs on ${capitalizeModelName(frontier.claude.model)} (${frontier.claude.effort}) · ${frontier.codex.model} (${frontier.codex.effort})`
      );
    } catch (err) {
      // Staged values are retained on error so the super-admin can retry
      // without re-entering everything.
      toast.error(err instanceof Error ? err.message : "Failed to save model tier defaults — try again");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-6 rounded-lg border p-6">
      <div>
        <h3 className="font-semibold">Model tier defaults</h3>
        <p className="text-sm text-muted-foreground">
          The model and reasoning effort each workflow tier runs on platform-wide, for Claude Code and for Codex.
          Changing a value takes effect on the <b>next</b> claim — no deploy. Per-user overrides in Profile → Model
          Tiers are unaffected.
        </p>
      </div>

      <div className="space-y-4">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Panel A · Tier defaults</p>
        <div className="grid grid-cols-[110px_minmax(0,1fr)_minmax(0,1fr)] gap-x-3 gap-y-3">
          <div />
          <div className="border-b pb-1 text-xs font-semibold text-muted-foreground">Claude</div>
          <div className="border-b pb-1 text-xs font-semibold text-muted-foreground">Codex</div>
          {TIER_FIELDS.map(({ tier, label }) => (
            <div key={tier} className="contents">
              <div className="pt-1.5">
                <p className="text-sm font-semibold">{label}</p>
                <p className="text-[11px] text-muted-foreground">{MODEL_TIER_WHEN_TO_USE[tier]}</p>
              </div>
              <AgentTierDefaultCell
                tier={tier}
                agent="claude"
                entry={staged.defaults[tier].claude}
                onModelChange={(v) => handleDefaultModelChange(tier, "claude", v)}
                onEffortChange={(e) => handleDefaultEffortChange(tier, "claude", e)}
                forceCustom={customFields[`default:${tier}:claude`] ?? false}
                onToggleCustom={(c) => setFieldCustom(`default:${tier}:claude`, c)}
                disabled={saving}
              />
              <AgentTierDefaultCell
                tier={tier}
                agent="codex"
                entry={staged.defaults[tier].codex}
                onModelChange={(v) => handleDefaultModelChange(tier, "codex", v)}
                onEffortChange={(e) => handleDefaultEffortChange(tier, "codex", e)}
                forceCustom={customFields[`default:${tier}:codex`] ?? false}
                onToggleCustom={(c) => setFieldCustom(`default:${tier}:codex`, c)}
                disabled={saving}
              />
              <p className="col-span-3 border-b border-dashed pb-2 text-[11px] text-muted-foreground">
                {tierResolutionLine(tier, staged.defaults[tier].claude, staged.defaults[tier].codex)}
              </p>
            </div>
          ))}
        </div>
      </div>

      <div className="space-y-4">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Panel B · Fallback chain{" "}
          <span className="font-normal normal-case tracking-normal text-muted-foreground">
            — used when a resolved model isn&apos;t on the caller&apos;s plan (model only — the tier defaults above
            carry the effort)
          </span>
        </p>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-4">
            <p className="text-[11px] font-medium text-muted-foreground">Claude</p>
            <div className="grid gap-4 sm:grid-cols-2">
              {FALLBACK_ROWS_CLAUDE.map((alias) => (
                <AgentModelField
                  key={alias}
                  id={`platform-fallback-claude-${alias}`}
                  agent="claude"
                  label={`${alias} falls back to`}
                  value={staged.fallback.claude[alias] ?? ""}
                  onChange={(v) => handleFallbackChange("claude", alias, v)}
                  forceCustom={customFields[`fallback:claude:${alias}`] ?? false}
                  onToggleCustom={(c) => setFieldCustom(`fallback:claude:${alias}`, c)}
                  disabled={saving}
                />
              ))}
            </div>
          </div>
          <div className="space-y-4">
            <p className="text-[11px] font-medium text-muted-foreground">Codex</p>
            <div className="grid gap-4 sm:grid-cols-2">
              {FALLBACK_ROWS_CODEX.map((model) => (
                <AgentModelField
                  key={model}
                  id={`platform-fallback-codex-${model}`}
                  agent="codex"
                  label={`${model} falls back to`}
                  value={staged.fallback.codex[model] ?? ""}
                  onChange={(v) => handleFallbackChange("codex", model, v)}
                  forceCustom={customFields[`fallback:codex:${model}`] ?? false}
                  onToggleCustom={(c) => setFieldCustom(`fallback:codex:${model}`, c)}
                  disabled={saving}
                />
              ))}
            </div>
          </div>
        </div>
      </div>

      {hasNovelValue && (
        <div
          id="platform-defaults-novel-warning"
          className="flex items-start gap-2.5 rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm"
        >
          <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
          <div className="space-y-2">
            <p>
              A value above isn&apos;t a known model. It will be sent verbatim (as the Task-tool{" "}
              <code className="rounded bg-muted px-1 py-0.5 text-xs">model</code> for Claude, or{" "}
              <code className="rounded bg-muted px-1 py-0.5 text-xs">-m</code> for Codex) on every affected step. If
              it&apos;s a typo, steps fall back at claim time.
            </p>
            <label className="flex cursor-pointer items-center gap-2 text-sm">
              <Checkbox checked={confirmedNovel} onCheckedChange={(c) => setConfirmedNovel(c === true)} />
              I&apos;ve verified this value is valid
            </label>
          </div>
        </div>
      )}

      {audit && (
        <div className="rounded-md border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
          {audit.isSeed ? (
            <span>Using code defaults — nothing saved yet. Saving writes the first row.</span>
          ) : (
            <span>
              Last changed by <b className="text-foreground">{audit.updatedBy?.full_name ?? "a super-admin"}</b>
              {audit.updatedAt ? ` · ${formatRelativeTime(audit.updatedAt)}` : ""} · Claude and Codex blocks are
              saved together as one row.
            </span>
          )}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2 border-t pt-4">
        {!isDirty && (
          <span id="platform-defaults-save-why" className="mr-auto text-xs text-muted-foreground">
            Save enables when you change a value.
          </span>
        )}
        {isDirty && hasNovelValue && !confirmedNovel && !hasBlockedCodexValue && (
          <span className="mr-auto text-xs text-muted-foreground">Confirm the checkbox above to enable Save.</span>
        )}
        {isDirty && hasBlockedCodexValue && (
          <span className="mr-auto text-xs text-muted-foreground">Fix the invalid Codex model to enable Save.</span>
        )}
        <Button type="button" variant="destructive" size="sm" onClick={handleResetToSeed} disabled={saving}>
          Reset to seed (both agents)
        </Button>
        <Button type="button" variant="outline" size="sm" onClick={handleCancel} disabled={saving || !isDirty}>
          Cancel
        </Button>
        <Button
          type="button"
          size="sm"
          onClick={handleSave}
          disabled={saveDisabled}
          aria-describedby={!isDirty ? "platform-defaults-save-why" : undefined}
        >
          {saving ? "Saving…" : "Save"}
        </Button>
      </div>
    </div>
  );
}

const NO_TERMINAL_DEFAULT_VALUE = "__no_default__";
const NO_CODEX_TERMINAL_DEFAULT = "__no_codex_default__";

type CardLoadState = "loading" | "error" | "ready";
type AuditStamp = { updatedBy: { full_name: string | null } | null; updatedAt: string | null };

/**
 * Shared shell for the two per-agent terminal cards (task fae2ce4f): title,
 * description, one loading skeleton, one error box with Retry. Both agents
 * render through it so their cards cannot drift apart.
 */
function TerminalSettingsCard({
  title,
  description,
  loadState,
  loadError,
  onRetry,
  children,
}: {
  title: string;
  description: React.ReactNode;
  loadState: CardLoadState;
  loadError: string;
  onRetry: () => void;
  children: React.ReactNode;
}) {
  if (loadState === "loading") {
    return (
      <div className="space-y-4 rounded-lg border p-4 sm:p-6">
        <Skeleton className="h-5 w-48" />
        <Skeleton className="h-4 w-full max-w-md" />
        <div className="max-w-[420px] space-y-1.5">
          <Skeleton className="h-4 w-20" />
          <Skeleton className="h-9 w-full" />
        </div>
      </div>
    );
  }
  if (loadState === "error") {
    return (
      <div className="rounded-lg border border-red-500/20 bg-red-500/5 p-6 text-center">
        <p className="text-sm text-red-400">{loadError}</p>
        <Button size="sm" variant="outline" className="mt-3" onClick={onRetry}>
          Retry
        </Button>
      </div>
    );
  }
  return (
    <div className="space-y-6 rounded-lg border p-4 sm:p-6">
      <div>
        <h3 className="font-semibold">{title}</h3>
        <p className="text-sm text-muted-foreground">{description}</p>
      </div>
      {children}
    </div>
  );
}

/** One setting inside a card: label, control (max 420px), then its own small audit line. */
function TerminalSettingRow({
  label,
  htmlFor,
  labelId,
  children,
  audit,
}: {
  label: string;
  htmlFor?: string;
  labelId?: string;
  children: React.ReactNode;
  audit: React.ReactNode;
}) {
  return (
    <div className="max-w-[420px] space-y-1.5">
      {htmlFor ? (
        <Label htmlFor={htmlFor} id={labelId} className="block text-xs font-medium">
          {label}
        </Label>
      ) : (
        <span id={labelId} className="block text-xs font-medium">
          {label}
        </span>
      )}
      {children}
      <p className="text-[11px] text-muted-foreground">{audit}</p>
    </div>
  );
}

/** "Last changed by X · 3d ago", or the row's own "Not set: ..." sentence. */
function auditText(isSet: boolean, stamp: AuditStamp | null, notSet: string): React.ReactNode {
  if (!isSet || !stamp) return notSet;
  return (
    <>
      Last changed by <b className="text-foreground">{stamp.updatedBy?.full_name ?? "a super-admin"}</b>
      {stamp.updatedAt ? ` · ${formatRelativeTime(stamp.updatedAt)}` : ""}
    </>
  );
}

function TerminalCardFooter({
  whyId,
  isDirty,
  hint,
  saving,
  saveDisabled,
  onCancel,
  onSave,
}: {
  whyId: string;
  isDirty: boolean;
  hint: string | null;
  saving: boolean;
  saveDisabled: boolean;
  onCancel: () => void;
  onSave: () => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2 border-t pt-4">
      {!isDirty && (
        <span id={whyId} className="mr-auto text-xs text-muted-foreground">
          Save enables when you change a value.
        </span>
      )}
      {isDirty && hint && <span className="mr-auto text-xs text-muted-foreground">{hint}</span>}
      <Button type="button" variant="outline" size="sm" onClick={onCancel} disabled={saving || !isDirty}>
        Cancel
      </Button>
      <Button type="button" size="sm" onClick={onSave} disabled={saveDisabled} aria-describedby={!isDirty ? whyId : undefined}>
        {saving ? "Saving…" : "Save"}
      </Button>
    </div>
  );
}

type RowOutcome = { row: string; ok: true; text: string } | { row: string; ok: false; message: string | null };

/** Runs each dirty row's write on its own key; one failing never undoes another. */
async function settleRows(rows: { row: string; run: () => Promise<string> }[]): Promise<RowOutcome[]> {
  const results = await Promise.allSettled(rows.map((r) => r.run()));
  return results.map((res, i): RowOutcome =>
    res.status === "fulfilled"
      ? { row: rows[i].row, ok: true, text: res.value }
      : { row: rows[i].row, ok: false, message: res.reason instanceof Error ? res.reason.message : null }
  );
}

function failureToast(failed: Extract<RowOutcome, { ok: false }>[]): string {
  const names = failed.map((f) => f.row).join(" and ");
  if (failed.length === 1 && failed[0].message) return `Couldn't save the ${names} — ${failed[0].message}`;
  return `Couldn't save the ${names} — try again`;
}

const CLAUDE_TERMINAL_DESCRIPTION = (
  <>
    What new in-browser Claude Code sessions start with, site-wide. Takes effect on the <b>next</b> session launched
    or resumed, with no deploy, and running sessions untouched. Users can choose their own in Settings → Model
    Tiers, and theirs wins.
  </>
);

const CODEX_TERMINAL_DESCRIPTION = (
  <>
    What new in-browser Codex sessions start with, site-wide. Takes effect on the <b>next</b> session launched
    (memory limit: launched or resumed), with no deploy, and running sessions untouched. Users can choose their own
    in Settings → Model Tiers, and theirs wins.
  </>
);

/**
 * Admin "Claude Code terminal sessions" card (task fae2ce4f): the site-wide
 * starting model, starting effort and memory limit for in-browser Claude Code
 * sessions, one card and one Save. Each setting is still its own
 * platform_settings key with its own audit; Save writes only the rows that
 * changed, so changing one never touches another. "Not set" is the first
 * choice of every control (there is no seed and no Clear button): resolution
 * then omits the value and Claude Code decides.
 */
export function AdminClaudeTerminalCard({ isSuperAdmin }: { isSuperAdmin: boolean }) {
  const [loadState, setLoadState] = useState<CardLoadState>("loading");
  const [reloadToken, setReloadToken] = useState(0);
  const [modelAudit, setModelAudit] = useState<PlatformTerminalModelAudit | null>(null);
  const [effortAudit, setEffortAudit] = useState<PlatformTerminalEffortAudit | null>(null);
  const [memoryAudit, setMemoryAudit] = useState<PlatformTerminalAutoCompactAudit | null>(null);
  // "" = not set for the model, mapped to `null` only at the server-action boundary.
  const [persistedModel, setPersistedModel] = useState("");
  const [stagedModel, setStagedModel] = useState("");
  const [persistedEffort, setPersistedEffort] = useState<string | null>(null);
  const [stagedEffort, setStagedEffort] = useState<string | null>(null);
  const [persistedMemory, setPersistedMemory] = useState<number | null>(null);
  const [stagedMemory, setStagedMemory] = useState<number | null>(null);
  const [forceCustom, setForceCustom] = useState(false);
  const [confirmedNovel, setConfirmedNovel] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!isSuperAdmin) return;
    let cancelled = false;
    setLoadState("loading");
    Promise.all([
      getPlatformTerminalModelDefaultForAdmin(),
      getPlatformTerminalEffortDefaultForAdmin(),
      getPlatformTerminalAutoCompactDefaultForAdmin("claude"),
    ])
      .then(([model, effort, memory]) => {
        if (cancelled) return;
        setModelAudit(model);
        setPersistedModel(model.value ?? "");
        setStagedModel(model.value ?? "");
        setEffortAudit(effort);
        setPersistedEffort(effort.value);
        setStagedEffort(effort.value);
        setMemoryAudit(memory);
        setPersistedMemory(memory.value);
        setStagedMemory(memory.value);
        setLoadState("ready");
      })
      .catch(() => {
        if (!cancelled) setLoadState("error");
      });
    return () => {
      cancelled = true;
    };
  }, [isSuperAdmin, reloadToken]);

  if (!isSuperAdmin) return <PlatformAccessDenied />;

  const modelDirty = stagedModel !== persistedModel;
  const effortDirty = stagedEffort !== persistedEffort;
  const memoryDirty = stagedMemory !== persistedMemory;
  const isDirty = modelDirty || effortDirty || memoryDirty;
  const isCustom = forceCustom || (stagedModel.length > 0 && !KNOWN_MODEL_VALUES.has(stagedModel));
  const structuralValidation = isCustom ? validateTerminalModelValue(stagedModel) : { ok: true as const };
  const structurallyBlocked = isCustom && !structuralValidation.ok;
  const isNovel = isCustom && structuralValidation.ok && !KNOWN_MODEL_VALUES.has(stagedModel.trim());
  const saveDisabled = saving || !isDirty || structurallyBlocked || (isNovel && !confirmedNovel);
  const hint = structurallyBlocked
    ? "Fix the model name to enable Save."
    : isNovel && !confirmedNovel
      ? "Confirm the checkbox above to enable Save."
      : null;

  function handleSelectChange(value: string) {
    if (value === CUSTOM_VALUE) {
      setForceCustom(true);
      return;
    }
    setForceCustom(false);
    setConfirmedNovel(false);
    setStagedModel(value === NO_TERMINAL_DEFAULT_VALUE ? "" : value);
  }

  function handleCancel() {
    setStagedModel(persistedModel);
    setStagedEffort(persistedEffort);
    setStagedMemory(persistedMemory);
    setForceCustom(false);
    setConfirmedNovel(false);
  }

  async function handleSave() {
    setSaving(true);
    const rows: { row: string; run: () => Promise<string> }[] = [];
    if (modelDirty) {
      rows.push({
        row: "starting model",
        run: async () => {
          const saved = await updatePlatformTerminalModelDefault(stagedModel.trim().length > 0 ? stagedModel.trim() : null);
          const fresh = await getPlatformTerminalModelDefaultForAdmin();
          setModelAudit(fresh);
          setPersistedModel(fresh.value ?? "");
          setStagedModel(fresh.value ?? "");
          setForceCustom(false);
          setConfirmedNovel(false);
          setPlatformTerminalModelDefaultCache(fresh.value);
          return saved ? `model ${capitalizeTerminalModelName(saved)}` : "model not set";
        },
      });
    }
    if (effortDirty) {
      rows.push({
        row: "starting effort",
        run: async () => {
          const saved = await updatePlatformTerminalEffortDefault(stagedEffort);
          const fresh = await getPlatformTerminalEffortDefaultForAdmin();
          setEffortAudit(fresh);
          setPersistedEffort(fresh.value);
          setStagedEffort(fresh.value);
          setPlatformTerminalEffortDefaultCache(fresh.value);
          return saved && isClaudeEffort(saved) ? `effort ${EFFORT_LABELS[saved]}` : "effort not set";
        },
      });
    }
    if (memoryDirty) {
      rows.push({
        row: "memory limit",
        run: async () => {
          const saved = await updatePlatformTerminalAutoCompactDefault("claude", stagedMemory);
          const fresh = await getPlatformTerminalAutoCompactDefaultForAdmin("claude");
          setMemoryAudit(fresh);
          setPersistedMemory(fresh.value);
          setStagedMemory(fresh.value);
          setPlatformTerminalAutoCompactDefaultCache("claude", fresh.value);
          return saved !== null ? `memory limit ${autoCompactShortLabel(saved)}` : "memory limit not set";
        },
      });
    }
    try {
      const outcomes = await settleRows(rows);
      const failed = outcomes.filter((o): o is Extract<RowOutcome, { ok: false }> => !o.ok);
      if (failed.length > 0) toast.error(failureToast(failed));
      else toast.success(`Claude Code site defaults saved · ${outcomes.map((o) => (o.ok ? o.text : "")).join(", ")}`);
    } finally {
      setSaving(false);
    }
  }

  return (
    <TerminalSettingsCard
      title="Claude Code terminal sessions"
      description={CLAUDE_TERMINAL_DESCRIPTION}
      loadState={loadState}
      loadError="Failed to load the Claude Code terminal settings."
      onRetry={() => setReloadToken((t) => t + 1)}
    >
      <TerminalSettingRow
        label="Starting model"
        htmlFor="platform-terminal-model"
        audit={auditText(
          modelAudit?.value != null,
          modelAudit,
          "Not set: each user's machine decides which model to start on."
        )}
      >
        {isCustom ? (
          <div className="flex flex-wrap items-center gap-2">
            <Input
              id="platform-terminal-model"
              value={stagedModel}
              onChange={(e) => setStagedModel(e.target.value)}
              placeholder="e.g. opus-5.5"
              disabled={saving}
              aria-invalid={structurallyBlocked}
              aria-describedby={
                structurallyBlocked
                  ? "platform-terminal-model-error"
                  : isNovel
                    ? "platform-terminal-model-novel-warning"
                    : undefined
              }
              className={cn(
                "min-w-[10rem] flex-1",
                structurallyBlocked && "border-rose-500 focus-visible:ring-rose-500/30",
                !structurallyBlocked && isNovel && "border-amber-500 focus-visible:ring-amber-500/30 dark:border-amber-500"
              )}
            />
            <Button type="button" variant="ghost" size="sm" disabled={saving} onClick={() => setForceCustom(false)}>
              Choose known…
            </Button>
          </div>
        ) : (
          <Select value={stagedModel || NO_TERMINAL_DEFAULT_VALUE} disabled={saving} onValueChange={handleSelectChange}>
            <SelectTrigger id="platform-terminal-model" className="w-full">
              <SelectValue>
                {stagedModel
                  ? (KNOWN_MODEL_OPTIONS.find((o) => o.value === stagedModel)?.label ?? stagedModel)
                  : "Not set — each user's machine decides"}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={NO_TERMINAL_DEFAULT_VALUE}>Not set — each user&apos;s machine decides</SelectItem>
              <SelectSeparator />
              {KNOWN_MODEL_OPTIONS.map((o) => (
                <SelectItem key={o.value} value={o.value}>
                  {o.label} <span className="text-muted-foreground">— {o.gloss}</span>
                </SelectItem>
              ))}
              <SelectSeparator />
              <SelectItem value={CUSTOM_VALUE}>Custom… (type a new family)</SelectItem>
            </SelectContent>
          </Select>
        )}
        {structurallyBlocked && !structuralValidation.ok && (
          <p id="platform-terminal-model-error" role="alert" className="flex items-center gap-1.5 text-xs text-rose-500">
            <TriangleAlert className="h-3.5 w-3.5 shrink-0" />
            {structuralValidation.reason}
          </p>
        )}
      </TerminalSettingRow>

      {isNovel && (
        <div
          id="platform-terminal-model-novel-warning"
          className="flex items-start gap-2.5 rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm"
        >
          <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
          <div className="space-y-2">
            <p>
              This isn&apos;t a known model alias. Every user&apos;s fresh terminal session will run{" "}
              <code className="rounded bg-muted px-1 py-0.5 text-xs">claude --model {stagedModel}</code> verbatim — if
              Claude rejects it, <b>every launch platform-wide</b> shows an error in the terminal until this is
              corrected.
            </p>
            <label className="flex cursor-pointer items-center gap-2 text-sm">
              <Checkbox checked={confirmedNovel} onCheckedChange={(c) => setConfirmedNovel(c === true)} />
              I&apos;ve verified this value works with the Claude CLI
            </label>
          </div>
        </div>
      )}

      <TerminalSettingRow
        label="Starting effort"
        labelId="platform-terminal-effort-label"
        audit={auditText(
          effortAudit?.value != null,
          effortAudit,
          "Not set: Claude Code decides (today's behaviour)."
        )}
      >
        <EffortSegmentedControl
          agent="claude"
          value={isClaudeEffort(stagedEffort) ? stagedEffort : null}
          disabled={saving}
          onChange={(effort) => setStagedEffort(effort)}
          groupLabel="Claude starting effort, site default"
          defaultOption={{ label: "Not set", subLabel: "Claude's own", onSelect: () => setStagedEffort(null) }}
        />
      </TerminalSettingRow>

      <TerminalSettingRow
        label="Memory limit"
        labelId="platform-terminal-claude-auto-compact-label"
        audit={auditText(
          memoryAudit?.value != null,
          memoryAudit,
          `Not set: Claude Code decides (${AUTO_COMPACT_OWN_SIZE_TEXT.claude}).`
        )}
      >
        <AutoCompactSegmentedControl
          agent="claude"
          value={isAutoCompactStep("claude", stagedMemory) ? stagedMemory : null}
          disabled={saving}
          onChange={setStagedMemory}
          groupLabel="Claude memory limit, site default"
          defaultOption={{ label: "Not set", subLabel: "Claude's own", onSelect: () => setStagedMemory(null) }}
        />
      </TerminalSettingRow>

      <TerminalCardFooter
        whyId="platform-terminal-claude-save-why"
        isDirty={isDirty}
        hint={hint}
        saving={saving}
        saveDisabled={saveDisabled}
        onCancel={handleCancel}
        onSave={handleSave}
      />
    </TerminalSettingsCard>
  );
}

type CodexPair = { model: string; effort: ReasoningEffort };

/**
 * Admin "Codex terminal sessions" card (task fae2ce4f): same three rows as the
 * Claude card. Codex saves its model and effort together as one pair under one
 * key, so the effort strip is only live once a model is chosen, and "Not set"
 * on the model clears both.
 */
export function AdminCodexTerminalCard({ isSuperAdmin }: { isSuperAdmin: boolean }) {
  const [loadState, setLoadState] = useState<CardLoadState>("loading");
  const [reloadToken, setReloadToken] = useState(0);
  const [pairAudit, setPairAudit] = useState<PlatformTerminalCodexModelAudit | null>(null);
  const [memoryAudit, setMemoryAudit] = useState<PlatformTerminalAutoCompactAudit | null>(null);
  const [persistedPair, setPersistedPair] = useState<CodexPair | null>(null);
  const [stagedPair, setStagedPair] = useState<CodexPair | null>(null);
  const [persistedMemory, setPersistedMemory] = useState<number | null>(null);
  const [stagedMemory, setStagedMemory] = useState<number | null>(null);
  const [forceCustom, setForceCustom] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!isSuperAdmin) return;
    let cancelled = false;
    setLoadState("loading");
    Promise.all([getPlatformTerminalCodexModelDefaultForAdmin(), getPlatformTerminalAutoCompactDefaultForAdmin("codex")])
      .then(([pair, memory]) => {
        if (cancelled) return;
        setPairAudit(pair);
        setPersistedPair(pair.value);
        setStagedPair(pair.value);
        setMemoryAudit(memory);
        setPersistedMemory(memory.value);
        setStagedMemory(memory.value);
        setLoadState("ready");
      })
      .catch(() => {
        if (!cancelled) setLoadState("error");
      });
    return () => {
      cancelled = true;
    };
  }, [isSuperAdmin, reloadToken]);

  if (!isSuperAdmin) return <PlatformAccessDenied />;

  const pairDirty = JSON.stringify(stagedPair) !== JSON.stringify(persistedPair);
  const memoryDirty = stagedMemory !== persistedMemory;
  const isDirty = pairDirty || memoryDirty;
  const validation = stagedPair ? validateCodexModelValue(stagedPair.model) : { ok: true as const };
  const blocked = !validation.ok;
  const custom = forceCustom || Boolean(stagedPair && !isKnownCodexModel(stagedPair.model));
  const saveDisabled = saving || !isDirty || blocked;

  function selectModel(value: string) {
    if (value === CUSTOM_VALUE) {
      setForceCustom(true);
      return;
    }
    setForceCustom(false);
    if (value === NO_CODEX_TERMINAL_DEFAULT) setStagedPair(null);
    else setStagedPair({ model: value, effort: stagedPair?.effort ?? "medium" });
  }

  function handleCancel() {
    setStagedPair(persistedPair);
    setStagedMemory(persistedMemory);
    setForceCustom(false);
  }

  async function handleSave() {
    setSaving(true);
    const rows: { row: string; run: () => Promise<string> }[] = [];
    if (pairDirty) {
      rows.push({
        row: "starting model and effort",
        run: async () => {
          await updatePlatformTerminalCodexModelDefault(stagedPair && { model: stagedPair.model.trim(), effort: stagedPair.effort });
          const fresh = await getPlatformTerminalCodexModelDefaultForAdmin();
          setPairAudit(fresh);
          setPersistedPair(fresh.value);
          setStagedPair(fresh.value);
          setForceCustom(false);
          setPlatformTerminalCodexModelDefaultCache(fresh.value);
          return fresh.value
              ? `model ${fresh.value.model}, effort ${EFFORT_LABELS[fresh.value.effort] ?? fresh.value.effort}`
              : "model not set";
        },
      });
    }
    if (memoryDirty) {
      rows.push({
        row: "memory limit",
        run: async () => {
          const saved = await updatePlatformTerminalAutoCompactDefault("codex", stagedMemory);
          const fresh = await getPlatformTerminalAutoCompactDefaultForAdmin("codex");
          setMemoryAudit(fresh);
          setPersistedMemory(fresh.value);
          setStagedMemory(fresh.value);
          setPlatformTerminalAutoCompactDefaultCache("codex", fresh.value);
          return saved !== null ? `memory limit ${autoCompactShortLabel(saved)}` : "memory limit not set";
        },
      });
    }
    try {
      const outcomes = await settleRows(rows);
      const failed = outcomes.filter((o): o is Extract<RowOutcome, { ok: false }> => !o.ok);
      if (failed.length > 0) toast.error(failureToast(failed));
      else toast.success(`Codex site defaults saved · ${outcomes.map((o) => (o.ok ? o.text : "")).join(", ")}`);
    } finally {
      setSaving(false);
    }
  }

  return (
    <TerminalSettingsCard
      title="Codex terminal sessions"
      description={CODEX_TERMINAL_DESCRIPTION}
      loadState={loadState}
      loadError="Failed to load the Codex terminal settings."
      onRetry={() => setReloadToken((t) => t + 1)}
    >
      <TerminalSettingRow
        label="Starting model"
        htmlFor="platform-terminal-codex-model"
        audit={auditText(
          pairAudit?.value != null,
          pairAudit,
          "Not set: using the Standard tier's Codex model."
        )}
      >
        {custom ? (
          <div className="flex gap-2">
            <Input
              id="platform-terminal-codex-model"
              value={stagedPair?.model ?? ""}
              disabled={saving}
              aria-invalid={blocked || undefined}
              onChange={(e) => setStagedPair({ model: e.target.value, effort: stagedPair?.effort ?? "medium" })}
              placeholder="e.g. gpt-6-astra"
            />
            <Button type="button" variant="ghost" size="sm" onClick={() => setForceCustom(false)}>
              Choose known…
            </Button>
          </div>
        ) : (
          <Select value={stagedPair?.model ?? NO_CODEX_TERMINAL_DEFAULT} disabled={saving} onValueChange={selectModel}>
            <SelectTrigger id="platform-terminal-codex-model" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={NO_CODEX_TERMINAL_DEFAULT}>Not set — the Standard tier&apos;s Codex model</SelectItem>
              <SelectSeparator />
              {KNOWN_CODEX_MODELS.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
              <SelectSeparator />
              <SelectItem value={CUSTOM_VALUE}>Custom…</SelectItem>
            </SelectContent>
          </Select>
        )}
        {blocked && !validation.ok && (
          <p role="alert" className="text-xs text-rose-500">
            {validation.reason}
          </p>
        )}
      </TerminalSettingRow>

      <TerminalSettingRow
        label="Starting effort"
        labelId="platform-terminal-codex-effort-label"
        audit={`Saved together with the model${stagedPair ? "." : ": pick a model to choose an effort."}`}
      >
        <EffortSegmentedControl
          agent="codex"
          value={stagedPair ? stagedPair.effort : null}
          disabled={saving}
          levelsDisabled={!stagedPair}
          onChange={(effort) => setStagedPair(stagedPair ? { ...stagedPair, effort } : stagedPair)}
          groupLabel="Codex starting effort, site default"
          defaultOption={{
            label: "Not set",
            subLabel: "with model",
            disabled: !!stagedPair,
            onSelect: () => setStagedPair(null),
          }}
        />
      </TerminalSettingRow>

      <TerminalSettingRow
        label="Memory limit"
        labelId="platform-terminal-codex-auto-compact-label"
        audit={auditText(
          memoryAudit?.value != null,
          memoryAudit,
          `Not set: Codex decides (${AUTO_COMPACT_OWN_SIZE_TEXT.codex}).`
        )}
      >
        <AutoCompactSegmentedControl
          agent="codex"
          value={isAutoCompactStep("codex", stagedMemory) ? stagedMemory : null}
          disabled={saving}
          onChange={setStagedMemory}
          groupLabel="Codex memory limit, site default"
          defaultOption={{ label: "Not set", subLabel: "Codex's own", onSelect: () => setStagedMemory(null) }}
        />
      </TerminalSettingRow>

      <TerminalCardFooter
        whyId="platform-terminal-codex-save-why"
        isDirty={isDirty}
        hint={blocked ? "Fix the model name to enable Save." : null}
        saving={saving}
        saveDisabled={saveDisabled}
        onCancel={handleCancel}
        onSave={handleSave}
      />
    </TerminalSettingsCard>
  );
}
