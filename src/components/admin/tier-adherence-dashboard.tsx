"use client";

import { useEffect, useMemo, useState } from "react";
import { CheckCircle2, TriangleAlert, CircleHelp, RotateCcw } from "lucide-react";
import { toast } from "sonner";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import {
  getTierAdherenceReport,
  type TierAdherenceStepRow,
  type TierAdherenceSummaryRow,
} from "@/actions/admin-tier-adherence";
import {
  TIER_ADHERENCE_DISCLOSURE,
  MODEL_TIERS,
  modelTierLabel,
  capitalizeModelName,
} from "@/lib/constants";
import { formatRelativeTime } from "@/lib/utils";

type LoadState = "loading" | "error" | "ready";

/**
 * P2c admin "Tier Adherence" card (Design-Review CONDITION 3, pulled into
 * scope for this card). Self-reported telemetry over the two P2c views
 * (migration 00135) — never framed as verification. Fetches its own data via
 * a server action (rather than the page-level SSR prop pattern the rest of
 * /admin uses) specifically so this card gets genuine loading/error states
 * distinct from the page shell.
 */
export function TierAdherenceDashboard() {
  const [state, setState] = useState<LoadState>("loading");
  const [summary, setSummary] = useState<TierAdherenceSummaryRow[]>([]);
  const [steps, setSteps] = useState<TierAdherenceStepRow[]>([]);
  const [tierFilter, setTierFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [reloadToken, setReloadToken] = useState(0);

  useEffect(() => {
    let cancelled = false;
    getTierAdherenceReport()
      .then(({ summary, steps }) => {
        if (cancelled) return;
        setSummary(summary);
        setSteps(steps);
        setState("ready");
      })
      .catch((err) => {
        if (cancelled) return;
        toast.error(err instanceof Error ? err.message : "Failed to load tier adherence data");
        setState("error");
      });
    return () => {
      cancelled = true;
    };
  }, [reloadToken]);

  const stats = useMemo(() => {
    const honored = steps.filter((s) => s.tier_honored === true).length;
    const dishonored = steps.filter((s) => s.tier_honored === false).length;
    const unknown = steps.filter((s) => s.tier_honored === null).length;
    return { honored, dishonored, unknown, total: steps.length };
  }, [steps]);

  const filteredSteps = useMemo(() => {
    let rows = steps;
    if (tierFilter !== "all") rows = rows.filter((s) => s.tier === tierFilter);
    const q = search.trim().toLowerCase();
    if (q) {
      rows = rows.filter(
        (s) =>
          s.task_title?.toLowerCase().includes(q) ||
          s.step_title.toLowerCase().includes(q) ||
          s.bot_name?.toLowerCase().includes(q)
      );
    }
    return rows;
  }, [steps, tierFilter, search]);

  if (state === "loading") {
    return (
      <div className="space-y-6">
        <div className="grid gap-4 sm:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="rounded-lg border p-4">
              <Skeleton className="mb-2 h-4 w-24" />
              <Skeleton className="h-8 w-16" />
            </div>
          ))}
        </div>
        <div className="rounded-lg border p-4">
          <Skeleton className="mb-4 h-5 w-40" />
          <div className="space-y-3">
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} className="h-6 w-full" />
            ))}
          </div>
        </div>
      </div>
    );
  }

  if (state === "error") {
    return (
      <div className="rounded-lg border border-red-500/20 bg-red-500/5 p-6 text-center">
        <p className="text-sm text-red-400">Failed to load tier adherence data.</p>
        <Button
          size="sm"
          variant="outline"
          className="mt-3 gap-1.5 text-xs"
          onClick={() => {
            setState("loading");
            setReloadToken((t) => t + 1);
          }}
        >
          <RotateCcw className="h-3 w-3" />
          Retry
        </Button>
      </div>
    );
  }

  if (steps.length === 0) {
    return (
      <div className="rounded-lg border p-8 text-center">
        <p className="text-sm font-medium">No tiered steps completed yet.</p>
        <p className="mt-1 text-xs text-muted-foreground">
          Rows appear after the first completion of a step that has a model tier.
        </p>
        <p className="mx-auto mt-3 max-w-md text-[11px] text-muted-foreground">
          {TIER_ADHERENCE_DISCLOSURE}
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard
          icon={<CheckCircle2 className="h-4 w-4 text-emerald-500" />}
          label="Honored"
          value={`${stats.honored} of ${stats.total}`}
        />
        <StatCard
          icon={<TriangleAlert className="h-4 w-4 text-amber-500" />}
          label="Not honored"
          value={`${stats.dishonored} of ${stats.total}`}
        />
        <StatCard
          icon={<CircleHelp className="h-4 w-4 text-muted-foreground" />}
          label="Not reported"
          value={`${stats.unknown} of ${stats.total}`}
        />
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-end gap-4 rounded-lg border p-4">
        <div className="space-y-1">
          <Label className="text-xs text-muted-foreground">Tier</Label>
          <Select value={tierFilter} onValueChange={setTierFilter}>
            <SelectTrigger className="h-8 w-40 text-xs">
              <SelectValue placeholder="All tiers" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All tiers</SelectItem>
              {MODEL_TIERS.map((t) => (
                <SelectItem key={t.value} value={t.value}>
                  {t.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label className="text-xs text-muted-foreground">Search</Label>
          <Input
            placeholder="Task, step, or reporter..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="h-8 w-56 text-xs"
          />
        </div>
      </div>

      {/* Drill-down table (workflow_tier_adherence_steps) */}
      <div>
        <h3 className="mb-3 text-sm font-semibold">Tiered steps</h3>
        <div className="max-h-[420px] overflow-y-auto rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Task / Step</TableHead>
                <TableHead>Tier</TableHead>
                <TableHead>Reported model</TableHead>
                <TableHead>Adherence</TableHead>
                <TableHead>Reported by</TableHead>
                <TableHead>Completed</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredSteps.map((row) => (
                <TableRow key={row.step_id}>
                  <TableCell>
                    <div className="max-w-64">
                      <p className="truncate text-xs font-medium">{row.task_title ?? "Untitled task"}</p>
                      <p className="truncate text-[11px] text-muted-foreground">{row.step_title}</p>
                    </div>
                  </TableCell>
                  <TableCell>
                    <span className="text-xs">{row.tier ? modelTierLabel(row.tier) : "—"}</span>
                  </TableCell>
                  <TableCell>
                    <span className="text-xs">
                      {row.executed_model ? capitalizeModelName(row.executed_model) : "—"}
                    </span>
                  </TableCell>
                  <TableCell>
                    <AdherenceBadge tierHonored={row.tier_honored} />
                  </TableCell>
                  <TableCell>
                    <span className="text-xs text-muted-foreground">{row.bot_name ?? "Unknown"}</span>
                  </TableCell>
                  <TableCell>
                    <span className="text-xs text-muted-foreground">
                      {row.completed_at ? formatRelativeTime(row.completed_at) : "—"}
                    </span>
                  </TableCell>
                </TableRow>
              ))}
              {filteredSteps.length === 0 && (
                <TableRow>
                  <TableCell colSpan={6} className="p-8 text-center text-sm text-muted-foreground">
                    No steps match this filter.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      </div>

      {/* Weekly summary (workflow_tier_adherence) — the "what to run weekly" query, design §05 Q1 */}
      {summary.length > 0 && (
        <div>
          <h3 className="mb-3 text-sm font-semibold">Weekly summary by user &amp; tier</h3>
          <div className="max-h-[280px] overflow-y-auto rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Week</TableHead>
                  <TableHead>User</TableHead>
                  <TableHead>Tier</TableHead>
                  <TableHead className="text-right">Honored</TableHead>
                  <TableHead className="text-right">Not honored</TableHead>
                  <TableHead className="text-right">Not reported</TableHead>
                  <TableHead className="text-right">Total</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {summary.map((row, i) => (
                  <TableRow key={`${row.week}-${row.user_id}-${row.run_id}-${row.tier}-${i}`}>
                    <TableCell>
                      <span className="text-xs text-muted-foreground">
                        {row.week ? new Date(row.week).toLocaleDateString() : "—"}
                      </span>
                    </TableCell>
                    <TableCell>
                      <span className="text-xs">{row.user_email ?? "Unknown"}</span>
                    </TableCell>
                    <TableCell>
                      <span className="text-xs">{row.tier ? modelTierLabel(row.tier) : "—"}</span>
                    </TableCell>
                    <TableCell className="text-right text-xs">{row.honored}</TableCell>
                    <TableCell className="text-right text-xs">
                      <span className={row.dishonored > 0 ? "font-medium text-amber-500" : ""}>
                        {row.dishonored}
                      </span>
                    </TableCell>
                    <TableCell className="text-right text-xs text-muted-foreground">{row.unknown}</TableCell>
                    <TableCell className="text-right text-xs">{row.total}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </div>
      )}

      <p className="max-w-2xl text-[11px] text-muted-foreground">{TIER_ADHERENCE_DISCLOSURE}</p>
    </div>
  );
}

function StatCard({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="rounded-lg border p-4">
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        {icon}
        {label}
      </div>
      <p className="mt-1 text-2xl font-bold">{value}</p>
    </div>
  );
}

function AdherenceBadge({ tierHonored }: { tierHonored: boolean | null }) {
  if (tierHonored === true) {
    return (
      <span className="inline-flex items-center gap-1 text-xs text-emerald-500">
        <CheckCircle2 className="h-3 w-3" /> Honored
      </span>
    );
  }
  if (tierHonored === false) {
    return (
      <span className="inline-flex items-center gap-1 text-xs text-amber-500">
        <TriangleAlert className="h-3 w-3" /> Not honored
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
      <CircleHelp className="h-3 w-3" /> Not reported
    </span>
  );
}
