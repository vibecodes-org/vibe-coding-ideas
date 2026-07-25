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
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  getPlatformModelDefaultsForAdmin,
  updatePlatformModelDefaults,
  type PlatformModelDefaultsAudit,
} from "@/actions/admin-platform";
import { setPlatformModelDefaultsCache } from "@/hooks/use-platform-model-defaults";
import {
  SEED_PLATFORM_MODEL_DEFAULTS,
  type PlatformModelDefaults,
} from "@/lib/platform-model-defaults";
import { MODEL_TIER_WHEN_TO_USE, capitalizeModelName, type ModelTierValue } from "@/lib/constants";

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

// Fixed set of fallback rows (Panel B) — mirrors the seed's alias-keyed chain.
// The fallback map is keyed by resolved MODEL, not by tier (Design-Review
// discrepancy note in docs/design-platform-model-defaults.html) — editing a
// 5th row for a brand-new family is a follow-up, not this MVP.
const FALLBACK_ROWS = ["fable", "opus", "sonnet", "haiku"] as const;

type StagedState = { defaults: PlatformModelDefaults["defaults"]; fallback: PlatformModelDefaults["fallback"] };

function stateEquals(a: StagedState, b: StagedState): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

function allStagedValues(state: StagedState): string[] {
  return [state.defaults.frontier, state.defaults.standard, state.defaults.cheap, ...FALLBACK_ROWS.map((k) => state.fallback[k] ?? "")];
}

/** One tier-default or fallback-chain row: a known-alias Select with a
 *  "Custom…" escape hatch that swaps to a free-text Input (novel model
 *  family, no schema change). */
function TierModelField({
  id,
  label,
  value,
  onChange,
  forceCustom,
  onToggleCustom,
  disabled,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  forceCustom: boolean;
  onToggleCustom: (custom: boolean) => void;
  disabled: boolean;
}) {
  const isCustom = forceCustom || (value.length > 0 && !KNOWN_MODEL_VALUES.has(value));
  const isNovel = value.trim().length > 0 && !KNOWN_MODEL_VALUES.has(value);

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
            placeholder="e.g. opus-5.5"
            disabled={disabled}
            aria-describedby={isNovel ? `${id}-novel-warning` : undefined}
            className={cn(
              "min-w-[10rem] flex-1",
              isNovel && "border-amber-500 focus-visible:ring-amber-500/30 dark:border-amber-500"
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
            <SelectValue>{KNOWN_MODEL_OPTIONS.find((o) => o.value === value)?.label ?? value}</SelectValue>
          </SelectTrigger>
          <SelectContent>
            {KNOWN_MODEL_OPTIONS.map((o) => (
              <SelectItem key={o.value} value={o.value}>
                {o.label} <span className="text-muted-foreground">— {o.gloss}</span>
              </SelectItem>
            ))}
            <SelectItem value={CUSTOM_VALUE}>Custom… (type a new family)</SelectItem>
          </SelectContent>
        </Select>
      )}
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
  const [audit, setAudit] = useState<PlatformModelDefaultsAudit | null>(null);
  const [persisted, setPersisted] = useState<StagedState>(SEED_PLATFORM_MODEL_DEFAULTS);
  const [staged, setStaged] = useState<StagedState>(SEED_PLATFORM_MODEL_DEFAULTS);
  const [customFields, setCustomFields] = useState<Record<string, boolean>>({});
  const [confirmedNovel, setConfirmedNovel] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!isSuperAdmin) return;
    let cancelled = false;
    setLoadState("loading");
    getPlatformModelDefaultsForAdmin()
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
  const hasNovelValue = allStagedValues(staged).some((v) => v.trim().length > 0 && !KNOWN_MODEL_VALUES.has(v));
  const saveDisabled = saving || !isDirty || (hasNovelValue && !confirmedNovel);

  function setFieldCustom(id: string, custom: boolean) {
    setCustomFields((prev) => ({ ...prev, [id]: custom }));
  }

  function handleDefaultChange(tier: ModelTierValue, value: string) {
    setStaged((prev) => ({ ...prev, defaults: { ...prev.defaults, [tier]: value } }));
  }

  function handleFallbackChange(alias: string, value: string) {
    setStaged((prev) => ({ ...prev, fallback: { ...prev.fallback, [alias]: value } }));
  }

  function handleCancel() {
    setStaged(persisted);
    setCustomFields({});
    setConfirmedNovel(false);
  }

  function handleResetToSeed() {
    // Local staging only — like the per-user Models dialog's "Reset to
    // defaults", this doesn't persist until Save is clicked.
    setStaged(SEED_PLATFORM_MODEL_DEFAULTS);
    setCustomFields({});
    setConfirmedNovel(false);
  }

  async function handleSave() {
    setSaving(true);
    try {
      await updatePlatformModelDefaults(staged);
      const fresh = await getPlatformModelDefaultsForAdmin();
      setAudit(fresh);
      setPersisted(fresh.value);
      setStaged(fresh.value);
      setCustomFields({});
      setConfirmedNovel(false);
      setPlatformModelDefaultsCache(fresh.value);
      toast.success(
        `Model tier defaults saved · frontier now runs on ${capitalizeModelName(fresh.value.defaults.frontier)}`
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
          The Claude model each workflow tier runs on platform-wide. Changing a value takes effect on the{" "}
          <b>next</b> claim — no deploy. Per-user overrides in Profile → Models are unaffected.
        </p>
      </div>

      <div className="space-y-4">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Panel A · Tier defaults</p>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {TIER_FIELDS.map(({ tier, label }) => (
            <div key={tier}>
              <TierModelField
                id={`platform-default-${tier}`}
                label={`${label} — ${MODEL_TIER_WHEN_TO_USE[tier]}`}
                value={staged.defaults[tier]}
                onChange={(v) => handleDefaultChange(tier, v)}
                forceCustom={customFields[`default:${tier}`] ?? false}
                onToggleCustom={(c) => setFieldCustom(`default:${tier}`, c)}
                disabled={saving}
              />
            </div>
          ))}
        </div>
      </div>

      <div className="space-y-4">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Panel B · Fallback chain{" "}
          <span className="font-normal normal-case tracking-normal text-muted-foreground">
            — used when a resolved model isn&apos;t on the caller&apos;s plan
          </span>
        </p>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {FALLBACK_ROWS.map((alias) => (
            <div key={alias}>
              <TierModelField
                id={`platform-fallback-${alias}`}
                label={`${alias} falls back to`}
                value={staged.fallback[alias] ?? ""}
                onChange={(v) => handleFallbackChange(alias, v)}
                forceCustom={customFields[`fallback:${alias}`] ?? false}
                onToggleCustom={(c) => setFieldCustom(`fallback:${alias}`, c)}
                disabled={saving}
              />
            </div>
          ))}
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
              A value above isn&apos;t a known model alias. It will be sent verbatim as the Task-tool{" "}
              <code className="rounded bg-muted px-1 py-0.5 text-xs">model</code> on every affected step. If it&apos;s
              a typo, steps fall back at claim time.
            </p>
            <label className="flex cursor-pointer items-center gap-2 text-sm">
              <Checkbox checked={confirmedNovel} onCheckedChange={(c) => setConfirmedNovel(c === true)} />
              I&apos;ve verified this alias is valid for the Task tool
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
              {audit.updatedAt ? ` · ${formatRelativeTime(audit.updatedAt)}` : ""}
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
        {isDirty && hasNovelValue && !confirmedNovel && (
          <span className="mr-auto text-xs text-muted-foreground">Confirm the checkbox above to enable Save.</span>
        )}
        <Button type="button" variant="destructive" size="sm" onClick={handleResetToSeed} disabled={saving}>
          Reset to seed
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
