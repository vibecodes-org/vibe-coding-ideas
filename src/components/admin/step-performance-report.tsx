"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { CircleDollarSign, GitBranch, RotateCcw, Undo2, Workflow } from "lucide-react";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import {
  getStepPerformanceReport,
  type StepReportBoard,
  type StepReportPeriod,
} from "@/actions/admin-step-report";
import type { StepPerformanceReport, StepPerformanceRow, TemplatePerformance } from "@/lib/step-cost/report";

type LoadState = "loading" | "ready" | "error";

const PERIODS: { value: StepReportPeriod; label: string }[] = [
  { value: "30", label: "Last 30 days" },
  { value: "60", label: "Last 60 days" },
  { value: "90", label: "Last 90 days" },
  { value: "all", label: "All time" },
];

function money(v: number | null): string {
  if (v === null) return "—";
  return v < 0.01 && v > 0 ? "<$0.01" : `$${v.toFixed(2)}`;
}

function mins(v: number | null): string {
  if (v === null) return "—";
  return v < 1 ? "<1 min" : `${Math.round(v)} min`;
}

function shortDate(iso: string | null): string {
  if (!iso) return "";
  return new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}

/** Card ba37039b: what each workflow step contributes — admin only. */
export function StepPerformanceReportView() {
  const [state, setState] = useState<LoadState>("loading");
  const [report, setReport] = useState<StepPerformanceReport | null>(null);
  const [boards, setBoards] = useState<StepReportBoard[]>([]);
  const [board, setBoard] = useState("all");
  const [period, setPeriod] = useState<StepReportPeriod>("60");
  const [reloadToken, setReloadToken] = useState(0);

  useEffect(() => {
    let cancelled = false;
    getStepPerformanceReport({ boardId: board === "all" ? null : board, period })
      .then((result) => {
        if (cancelled) return;
        setReport(result.report);
        setBoards(result.boards);
        setState("ready");
      })
      .catch((err) => {
        if (cancelled) return;
        toast.error(err instanceof Error ? err.message : "Failed to load the step report");
        setState("error");
      });
    return () => {
      cancelled = true;
    };
  }, [board, period, reloadToken]);

  // Loading is set where the change happens, not in the effect above.
  function changeBoard(value: string) {
    setState("loading");
    setBoard(value);
  }
  function changePeriod(value: string) {
    setState("loading");
    setPeriod(value as StepReportPeriod);
  }
  function retry() {
    setState("loading");
    setReloadToken((t) => t + 1);
  }

  const filters = (
    <div className="flex flex-wrap items-end gap-4 rounded-lg border p-4">
      <div className="space-y-1">
        <Label className="text-xs text-muted-foreground">Board</Label>
        <Select value={board} onValueChange={changeBoard}>
          <SelectTrigger className="h-8 w-56 text-xs">
            <SelectValue placeholder="All boards" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All boards</SelectItem>
            {boards.map((b) => (
              <SelectItem key={b.id} value={b.id}>
                {b.title}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="space-y-1">
        <Label className="text-xs text-muted-foreground">Period</Label>
        <Select value={period} onValueChange={changePeriod}>
          <SelectTrigger className="h-8 w-40 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {PERIODS.map((p) => (
              <SelectItem key={p.value} value={p.value}>
                {p.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </div>
  );

  if (state === "loading" && !report) {
    return (
      <div className="space-y-6">
        <div className="grid gap-4 sm:grid-cols-4">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="rounded-lg border p-4">
              <Skeleton className="mb-2 h-4 w-24" />
              <Skeleton className="h-8 w-16" />
            </div>
          ))}
        </div>
        <div className="rounded-lg border p-4">
          <Skeleton className="mb-4 h-5 w-40" />
          <div className="space-y-3">
            {[0, 1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-6 w-full" />
            ))}
          </div>
        </div>
      </div>
    );
  }

  if (state === "error" && !report) {
    return (
      <div className="rounded-lg border border-red-500/20 bg-red-500/5 p-6 text-center">
        <p className="text-sm text-red-400">Failed to load the step report.</p>
        <Button variant="outline" size="sm" className="mt-3 gap-1.5 text-xs" onClick={retry}>
          <RotateCcw className="h-3 w-3" />
          Try again
        </Button>
      </div>
    );
  }

  const r = report!;
  return (
    <div className={`space-y-6 ${state === "loading" ? "opacity-60" : ""}`}>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard icon={<Workflow className="h-4 w-4 text-muted-foreground" />} label="Workflow runs" value={String(r.summary.runs)} note="with a finished step in the period" />
        <StatCard
          icon={<CircleDollarSign className="h-4 w-4 text-emerald-500" />}
          label="Cost recorded"
          value={money(r.summary.costRecorded)}
          note={`on ${r.summary.runsWithCost} run${r.summary.runsWithCost === 1 ? "" : "s"}`}
        />
        <StatCard icon={<GitBranch className="h-4 w-4 text-muted-foreground" />} label="Cost per finished run" value={money(r.summary.medianCostPerFinishedRun)} note="median, runs with every step's cost recorded" />
        <StatCard icon={<Undo2 className="h-4 w-4 text-amber-500" />} label="Work sent back" value={String(r.summary.workSentBack)} note="steps whose agent caught a problem" />
      </div>

      {filters}

      {state === "error" && (
        <div className="flex items-center justify-between gap-3 rounded-lg border border-red-500/20 bg-red-500/5 px-4 py-3">
          <p className="text-xs text-red-400">Couldn&apos;t load the report for these filters. The figures below are from the last load.</p>
          <Button variant="outline" size="sm" className="h-7 gap-1.5 text-xs" onClick={retry}>
            <RotateCcw className="h-3 w-3" />
            Try again
          </Button>
        </div>
      )}

      {r.summary.unpricedModels.length > 0 && (
        <div className="rounded-lg border border-amber-500/20 bg-amber-500/5 px-4 py-3 text-xs text-amber-500">
          No price is set for {r.summary.unpricedModels.join(", ")}, so steps that used {r.summary.unpricedModels.length === 1 ? "it" : "them"} show no cost.
          Add {r.summary.unpricedModels.length === 1 ? "it" : "them"} to <code className="font-mono">src/lib/step-cost/pricing.ts</code>.
        </div>
      )}

      {r.templates.length === 0 ? (
        <div className="rounded-lg border p-8 text-center">
          <p className="text-sm font-medium">No workflow steps finished in this period.</p>
          <p className="mt-1 text-xs text-muted-foreground">Try a longer period or another board.</p>
        </div>
      ) : (
        r.templates.map((t) => <TemplateSection key={t.key} template={t} />)
      )}

      <div className="max-w-3xl space-y-1 text-[11px] text-muted-foreground">
        <p>
          <span className="font-medium text-foreground">Caught problems:</span> the step&apos;s agent sent work back to an earlier step.{" "}
          <span className="font-medium text-foreground">You rejected:</span> a person failed a step that has an approval gate.{" "}
          <span className="font-medium text-foreground">Had to redo:</span> a later step, or a person, sent work back to this step. Each counts runs, not messages.
        </p>
        <p>
          <span className="font-medium text-foreground">Cost per run:</span> median cost of one run of the step, every attempt included, over the runs that recorded it.
          It&apos;s what the tokens would cost at Anthropic API prices, whether the session ran on a subscription or an API key. Sessions report it from their
          subagent&apos;s Claude Code transcript; output tokens are estimated from text length, so totals are within about 10%. Steps a session ran without a
          subagent, Codex steps, steps on a model with no price, and runs from before cost tracking show no cost. A run that started before
          the period isn&apos;t counted in the whole-run figures.
        </p>
        <p>
          With All boards, templates with the same name are combined. A step that has run 5+ times and caught a problem in at least 1 in 5 runs is marked
          &ldquo;Catches problems&rdquo;; one that has run 10+ times with nothing caught or rejected is marked &ldquo;Never caught anything&rdquo;. Earlier-version
          steps that ran fewer than 3 times are left out.
        </p>
      </div>
    </div>
  );
}

function TemplateSection({ template }: { template: TemplatePerformance }) {
  const hasEarlier = template.earlier.length > 0 || template.earlierRuns > 0;
  return (
    <div>
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-sm font-semibold">{template.name}</h3>
        {template.currentRuns > 0 && (
          <span className="text-[11px] text-muted-foreground">
            {template.currentRuns} run{template.currentRuns === 1 ? "" : "s"} on the current steps
            {template.currentSince ? ` since ${shortDate(template.currentSince)}` : ""}
          </span>
        )}
      </div>
      {template.current.length > 0 ? (
        <StepTable rows={template.current} numbered wholeRun={template.wholeRun} />
      ) : (
        <div className="rounded-lg border border-dashed p-4 text-xs text-muted-foreground">
          No run has finished a step of this template&apos;s current version in this period.
        </div>
      )}
      {hasEarlier && (
        <details className="mt-3">
          <summary className="cursor-pointer text-xs font-medium text-violet-400 hover:underline">
            Earlier versions of this template · {template.earlierRuns} run{template.earlierRuns === 1 ? "" : "s"}
          </summary>
          <div className="mt-2">
            {template.earlier.length > 0 ? (
              <StepTable rows={template.earlier} />
            ) : (
              <p className="text-xs text-muted-foreground">No earlier step ran 3 or more times.</p>
            )}
          </div>
        </details>
      )}
    </div>
  );
}

function StepTable({
  rows,
  numbered = false,
  wholeRun = null,
}: {
  rows: StepPerformanceRow[];
  numbered?: boolean;
  wholeRun?: TemplatePerformance["wholeRun"];
}) {
  return (
    <div className="overflow-x-auto rounded-lg border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Step</TableHead>
            <TableHead className="text-right">Ran</TableHead>
            <TableHead className="text-right">Caught problems</TableHead>
            <TableHead className="text-right">You rejected</TableHead>
            <TableHead className="text-right">Had to redo</TableHead>
            <TableHead className="text-right">Median time</TableHead>
            <TableHead className="text-right">Cost per run</TableHead>
            <TableHead>Model</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row, i) => (
            <TableRow key={row.title}>
              <TableCell>
                <div className="flex items-center gap-2 text-xs font-medium">
                  {numbered && (
                    <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-muted text-[10px] font-semibold text-muted-foreground">
                      {i + 1}
                    </span>
                  )}
                  <span className="max-w-64 truncate">{row.title}</span>
                  <Chip chip={row.chip} />
                </div>
              </TableCell>
              <TableCell className="text-right text-xs">{row.ran}</TableCell>
              <TableCell className="text-right text-xs">
                <Count n={row.caught} of={row.ran} strong />
              </TableCell>
              <TableCell className="text-right text-xs">
                <Count n={row.rejected} of={row.ran} />
              </TableCell>
              <TableCell className="text-right text-xs">
                <Count n={row.redo} />
              </TableCell>
              <TableCell className="text-right text-xs">{mins(row.medianMinutes)}</TableCell>
              <TableCell className="text-right text-xs">
                {row.medianCost === null ? (
                  <span className="text-muted-foreground">not recorded</span>
                ) : (
                  <span title={`Recorded on ${row.costRuns} run${row.costRuns === 1 ? "" : "s"}`}>{money(row.medianCost)}</span>
                )}
              </TableCell>
              <TableCell>
                <span className="font-mono text-[11px] text-muted-foreground">{row.model ?? "—"}</span>
              </TableCell>
            </TableRow>
          ))}
          {wholeRun && (
            <TableRow>
              <TableCell className="text-xs font-semibold">Whole run</TableCell>
              <TableCell colSpan={4} />
              <TableCell className="text-right text-xs font-semibold">{mins(wholeRun.medianMinutes)}</TableCell>
              <TableCell className="text-right text-xs font-semibold">{money(wholeRun.medianCost)}</TableCell>
              <TableCell />
            </TableRow>
          )}
        </TableBody>
      </Table>
    </div>
  );
}

function Count({ n, of, strong = false }: { n: number; of?: number; strong?: boolean }) {
  if (n === 0) return <span className="text-muted-foreground">0</span>;
  return (
    <span className={strong ? "font-medium text-emerald-500" : ""}>
      {n}
      {of !== undefined && <span className="ml-1 text-[11px] text-muted-foreground">of {of}</span>}
    </span>
  );
}

function Chip({ chip }: { chip: StepPerformanceRow["chip"] }) {
  if (chip === "catches") {
    return <span className="rounded-full bg-emerald-500/10 px-1.5 py-0.5 text-[10px] font-medium text-emerald-500">Catches problems</span>;
  }
  if (chip === "never") {
    return <span className="rounded-full bg-amber-500/10 px-1.5 py-0.5 text-[10px] font-medium text-amber-500">Never caught anything</span>;
  }
  return null;
}

function StatCard({ icon, label, value, note }: { icon: React.ReactNode; label: string; value: string; note: string }) {
  return (
    <div className="rounded-lg border p-4">
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        {icon}
        {label}
      </div>
      <p className="mt-1 text-2xl font-bold">{value}</p>
      <p className="mt-0.5 text-[11px] text-muted-foreground">{note}</p>
    </div>
  );
}
