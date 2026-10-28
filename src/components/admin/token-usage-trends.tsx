"use client";

import { Bar, BarChart, CartesianGrid, Cell, LabelList, Line, LineChart, ReferenceLine, XAxis, YAxis } from "recharts";
import { ChartContainer, ChartTooltip, type ChartConfig } from "@/components/ui/chart";
import { visibleMarkers } from "@/lib/step-cost/change-markers";
import { ukDay, ukWeekStart, type CostBucket, type CostTrends } from "@/lib/step-cost/trends";
import { unmeasuredLabel } from "@/lib/step-cost/unmeasured";

// Card a1790638: how costs are trending. Drawn with the shadcn chart (recharts);
// this file is loaded only on the Token usage tab. Layout and wording follow
// docs/token-usage-trends-mock.html.

const LOW_COVERAGE = 0.8;
const ROUGH_RUNS = 3;

// Series colours, set once for light and dark and picked up by the legends as well as the charts.
const PALETTE = `
[data-tu] { --tu-opus: #7c3aed; --tu-sonnet: #0284c7; --tu-other: #db2777; --tu-marker: #d97706; --tu-amber: #b45309; --tu-s0: #0284c7; --tu-s1: #7c3aed; --tu-s2: #db2777; --tu-share: #52525b; }
.dark [data-tu] { --tu-opus: #8b5cf6; --tu-sonnet: #0891b2; --tu-other: #db2777; --tu-marker: #f59e0b; --tu-amber: #f59e0b; --tu-s0: #0891b2; --tu-s1: #8b5cf6; --tu-s2: #db2777; --tu-share: #a1a1aa; }
`;

const costConfig = {
  opus: { label: "Opus", color: "var(--tu-opus)" },
  sonnet: { label: "Sonnet", color: "var(--tu-sonnet)" },
  other: { label: "Other models", color: "var(--tu-other)" },
  marker: { label: "A change went live", color: "var(--tu-marker)" },
  amber: { label: "Low", color: "var(--tu-amber)" },
} satisfies ChartConfig;

const SERIES_COLORS = ["var(--tu-s0)", "var(--tu-s1)", "var(--tu-s2)"];
const seriesConfig = {
  s0: { label: "", color: "var(--tu-s0)" },
  s1: { label: "", color: "var(--tu-s1)" },
  s2: { label: "", color: "var(--tu-s2)" },
} satisfies ChartConfig;

const sentConfig = { share: { label: "Sent back", color: "var(--tu-share)" } } satisfies ChartConfig;

export function money(v: number): string {
  return v >= 1000 ? `$${(v / 1000).toFixed(1)}k` : v >= 100 ? `$${Math.round(v)}` : `$${v.toFixed(v < 10 ? 2 : 0)}`;
}
export function money2(v: number): string {
  return `$${v.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
export function fmtDay(day: string): string {
  return new Date(`${day}T12:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
}
const pct = (costed: number, finished: number) => Math.round((100 * costed) / finished);
const isLow = (b: CostBucket) => b.finished > 0 && b.costed / b.finished < LOW_COVERAGE;

function ChartCard({ title, note, children }: { title: string; note: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0 rounded-lg border p-4">
      <div className="mb-1 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h3 className="text-sm font-semibold">{title}</h3>
        <span className="text-[11px] text-muted-foreground">{note}</span>
      </div>
      {children}
    </div>
  );
}

function Tip({ children }: { children: React.ReactNode }) {
  return <div className="rounded-md border bg-popover px-2 py-1.5 text-[11px] leading-snug text-popover-foreground shadow-md">{children}</div>;
}

function Swatch({ color }: { color: string }) {
  return <span className="mr-1.5 inline-block h-2 w-2 rounded-sm" style={{ background: color }} />;
}

function DataTable({ head, rows }: { head: string[]; rows: (string | number)[][] }) {
  return (
    <details className="mt-2 text-[11px] text-muted-foreground">
      <summary className="cursor-pointer">Show these figures as a table</summary>
      <div className="mt-1.5 overflow-x-auto rounded-lg border">
        <table className="w-full text-xs">
          <thead>
            <tr>
              {head.map((h, i) => (
                <th key={h} className={`whitespace-nowrap border-b p-2 font-medium ${i === 0 ? "text-left" : "text-right"}`}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r, ri) => (
              <tr key={ri}>
                {r.map((c, i) => (
                  <td key={i} className={`whitespace-nowrap border-b p-2 text-foreground ${i === 0 ? "text-left" : "text-right"}`}>
                    {c}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  );
}

const MAX_REASONS = 5;

function UnmeasuredReasons({ reasons }: { reasons: CostTrends["unmeasuredReasons"] }) {
  if (reasons.length === 0) return null;
  const shown = reasons.slice(0, MAX_REASONS);
  return (
    <div className="mt-3 border-t border-border pt-2.5">
      <h3 className="text-xs font-semibold">Why some costs couldn&apos;t be measured</h3>
      <ul className="mt-1.5 grid gap-1 text-xs">
        {shown.map((r) => {
          const label = unmeasuredLabel(r.kind, r.reason);
          return (
            <li key={r.key} className="grid grid-cols-[22px_1fr] items-baseline gap-x-2 sm:grid-cols-[22px_auto_1fr]">
              <span className="min-w-[22px] text-right font-semibold tabular-nums">{r.steps}</span>
              <span>
                {label.text}
                {label.quote && <q className="ml-1 text-muted-foreground">{label.quote}</q>}
              </span>
              <span className="col-start-2 text-[11px] text-muted-foreground sm:col-start-auto">last {fmtDay(ukDay(r.lastAt))}</span>
            </li>
          );
        })}
      </ul>
      {reasons.length > MAX_REASONS && (
        <p className="mt-1 pl-[30px] text-[11px] text-muted-foreground">and {reasons.length - MAX_REASONS} more reason{reasons.length - MAX_REASONS === 1 ? "" : "s"}</p>
      )}
    </div>
  );
}

function Summary({ trends }: { trends: CostTrends }) {
  const { lastFullWeek, workflowMoves } = trends.summary;
  const arrow = (from: number, to: number) =>
    to < from ? (
      <span className="text-emerald-500">▼ {money2(from)} → {money2(to)}</span>
    ) : (
      <span className="text-amber-500">▲ {money2(from)} → {money2(to)}</span>
    );
  if (!lastFullWeek && workflowMoves.length === 0) return null;
  return (
    <div className="mb-3 flex flex-wrap gap-x-6 gap-y-2 text-xs">
      {lastFullWeek && (
        <span>
          Last full week ({fmtDay(lastFullWeek.start)}): <b className="font-semibold">{money2(lastFullWeek.total)}</b>
          {lastFullWeek.changePct !== null && (
            <>
              {" "}
              <span className={lastFullWeek.changePct > 0 ? "text-amber-500" : "text-emerald-500"}>
                {lastFullWeek.changePct > 0 ? "▲" : "▼"} {Math.abs(Math.round(lastFullWeek.changePct))}% on the {lastFullWeek.comparedWeeks} full week{lastFullWeek.comparedWeeks === 1 ? "" : "s"} before
              </span>
            </>
          )}
        </span>
      )}
      {workflowMoves.map((m) => (
        <span key={m.name}>
          Typical {m.name} run, week of {fmtDay(m.fromStart)} → week of {fmtDay(m.toStart)}: {arrow(m.from, m.to)}
        </span>
      ))}
    </div>
  );
}

// The bar's coverage under its date label: a percentage a week, a mark under a low day.
function CoverageTick(props: {
  x?: number | string;
  y?: number | string;
  payload?: { value: string };
  byStart: Map<string, CostBucket>;
  grain: "day" | "week";
}) {
  const { byStart, grain } = props;
  const b = byStart.get(props.payload?.value ?? "");
  if (!b) return <g />;
  const low = isLow(b);
  return (
    <g transform={`translate(${Number(props.x)},${Number(props.y)})`}>
      <text y={12} textAnchor="middle" fontSize={10} className="fill-muted-foreground">
        {fmtDay(b.start)}
      </text>
      {b.finished > 0 && (grain === "week" || low) && (
        <text y={26} textAnchor="middle" fontSize={10} fontWeight={low ? 600 : 400} fill={low ? "var(--tu-amber)" : undefined} className={low ? undefined : "fill-muted-foreground"}>
          {grain === "week" ? `${pct(b.costed, b.finished)}%` : "▲"}
        </text>
      )}
    </g>
  );
}

export function TokenUsageTrends({ trends }: { trends: CostTrends }) {
  const { cost, weeks, runCost, sentBack, grain } = trends;
  const hasCost = cost.some((b) => b.total > 0);
  const byStart = new Map(cost.map((b) => [b.start, b]));
  const unit = grain === "day" ? "day" : "week";

  // Markers sit on the bar of the day or week they fall in.
  const bucketOf = (date: string) => (grain === "day" ? date : ukWeekStart(`${date}T12:00:00Z`));
  const markers = cost.length ? visibleMarkers(cost[0].start) : [];
  const stackRow = new Map<string, number>();
  const placed = markers.map((m) => {
    const at = bucketOf(m.date);
    const row = stackRow.get(at) ?? 0;
    stackRow.set(at, row + 1);
    return { ...m, at, row };
  });

  const weekStarts = new Set(weeks.map((w) => w.start));
  const weekMarkers = (weeks.length ? visibleMarkers(weeks[0].start) : [])
    .map((m) => ({ ...m, at: ukWeekStart(`${m.date}T12:00:00Z`) }))
    .filter((m) => weekStarts.has(m.at));

  const maxTotal = Math.max(0, ...cost.map((b) => b.total));
  // A sliver on top of each stack, so there is always a bar to hang the total label on.
  const bars = cost.map((b) => ({ ...b, cap: maxTotal * 0.001 }));
  const runRows = weeks.map((w, i) => {
    const row: Record<string, string | number | null> = { start: w.start, partial: w.partial ? 1 : 0 };
    runCost.forEach((s, k) => {
      row[`s${k}`] = s.points[i].median;
      row[`s${k}runs`] = s.points[i].runs;
    });
    return row;
  });
  const sentRows = sentBack.map((s) => ({ ...s, share: s.runs ? s.sentBack / s.runs : null }));

  return (
    <section className="space-y-6" aria-label="Cost trends" data-tu="">
      <style>{PALETTE}</style>
      <div>
        <div className="mb-1 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
          <h3 className="text-sm font-semibold">How costs are trending</h3>
          <span className="text-[11px] text-muted-foreground">
            {grain === "week"
              ? "By week, Monday to Sunday (UK time). This week is so far."
              : "Cost by day for 30 days; the run charts stay weekly (too few runs a day)."}
          </span>
        </div>
        <Summary trends={trends} />
      </div>

      <ChartCard title={`Cost per ${unit}, by model`} note="at Anthropic API prices">
        {hasCost ? (
          <>
            <div className="my-1.5 flex flex-wrap gap-x-3.5 gap-y-1 text-xs text-muted-foreground">
              <span><Swatch color="var(--tu-opus)" />Opus</span>
              <span><Swatch color="var(--tu-sonnet)" />Sonnet</span>
              <span><Swatch color="var(--tu-other)" />Other models</span>
              {placed.length > 0 && (
                <span className="inline-flex items-center">
                  <span className="mr-1.5 inline-block h-2.5 border-l border-dashed" style={{ borderColor: "var(--tu-marker)" }} />
                  A change went live
                </span>
              )}
            </div>
            <ChartContainer config={costConfig} className="aspect-auto h-[260px] w-full">
              <BarChart data={bars} margin={{ top: 14 + placed.reduce((m, p) => Math.max(m, p.row), 0) * 16 + 14, right: 8, left: 0, bottom: 14 }}>
                <CartesianGrid vertical={false} />
                <XAxis dataKey="start" tickLine={false} axisLine={false} interval="equidistantPreserveStart" minTickGap={grain === "day" ? 14 : 2} height={36} tick={<CoverageTick byStart={byStart} grain={grain} />} />
                <YAxis width={44} tickLine={false} axisLine={false} tickFormatter={money} domain={[0, (max: number) => max * 1.15]} />
                <ChartTooltip
                  cursor={{ fill: "var(--muted)", opacity: 0.4 }}
                  content={({ active, payload }) => {
                    const b = active ? (payload?.[0]?.payload as CostBucket | undefined) : undefined;
                    if (!b) return null;
                    return (
                      <Tip>
                        <b className="font-semibold">{grain === "week" ? `Week of ${fmtDay(b.start)}` : fmtDay(b.start)}{b.partial ? " (so far)" : ""}</b>
                        <br />
                        <Swatch color="var(--tu-opus)" />Opus {money2(b.opus)}
                        <br />
                        <Swatch color="var(--tu-sonnet)" />Sonnet {money2(b.sonnet)}
                        {b.other > 0 && (
                          <>
                            <br />
                            <Swatch color="var(--tu-other)" />Other {money2(b.other)}
                          </>
                        )}
                        <br />
                        <b className="font-semibold">Total {money2(b.total)}</b>
                        <br />
                        {b.costed} of {b.finished} finished steps have a cost
                        <div className="my-1 border-t border-border" />
                        {b.unmeasured} couldn&apos;t be measured (reason given)
                        <br />
                        {b.finished - b.costed - b.unmeasured} missing: nothing reported
                      </Tip>
                    );
                  }}
                />
                {placed.map((m) => (
                  <ReferenceLine
                    key={m.date}
                    x={m.at}
                    stroke="var(--tu-marker)"
                    strokeDasharray="3 3"
                    strokeWidth={1.25}
                    ifOverflow="visible"
                    label={({ viewBox }: { viewBox?: { x?: number; y?: number } }) => (
                      <g transform={`translate(${viewBox?.x ?? 0},${(viewBox?.y ?? 0) - 12 - m.row * 16})`}>
                        <title>{`${fmtDay(m.date)}: ${m.label}`}</title>
                        <circle r={7} className="fill-background" stroke="var(--tu-marker)" strokeWidth={1.5} />
                        <text y={3} textAnchor="middle" fontSize={8.5} fontWeight={700} fill="var(--tu-marker)">
                          {m.number}
                        </text>
                      </g>
                    )}
                  />
                ))}
                <Bar isAnimationActive={false} dataKey="opus" stackId="c" fill="var(--tu-opus)" maxBarSize={grain === "week" ? 44 : 14}>
                  {bars.map((b) => <Cell key={b.start} fill="var(--tu-opus)" fillOpacity={b.partial ? 0.55 : 1} />)}
                </Bar>
                <Bar isAnimationActive={false} dataKey="sonnet" stackId="c" fill="var(--tu-sonnet)" maxBarSize={grain === "week" ? 44 : 14}>
                  {bars.map((b) => <Cell key={b.start} fill="var(--tu-sonnet)" fillOpacity={b.partial ? 0.55 : 1} />)}
                </Bar>
                <Bar isAnimationActive={false} dataKey="other" stackId="c" fill="var(--tu-other)" maxBarSize={grain === "week" ? 44 : 14} radius={[4, 4, 0, 0]}>
                  {bars.map((b) => <Cell key={b.start} fill="var(--tu-other)" fillOpacity={b.partial ? 0.55 : 1} />)}
                </Bar>
                {grain === "week" && (
                  <Bar isAnimationActive={false} dataKey="cap" stackId="c" fill="transparent" stroke="none" maxBarSize={44}>
                    <LabelList
                      dataKey="start"
                      content={(p: { x?: number | string; y?: number | string; width?: number | string; value?: unknown }) => {
                        const b = byStart.get(String(p.value));
                        if (!b || b.total <= 0) return null;
                        return (
                          <text x={Number(p.x) + Number(p.width) / 2} y={Number(p.y) - 5} textAnchor="middle" fontSize={10} fontWeight={600} className="fill-foreground">
                            {money(b.total)}{b.partial ? "*" : ""}
                          </text>
                        );
                      }}
                    />
                  </Bar>
                )}
              </BarChart>
            </ChartContainer>
            <p className="mt-0.5 text-[11px] text-muted-foreground">
              Under each {unit}: the share of finished steps with a cost recorded. Amber under 80% (a ▲ under a day) means that bar is short of the real cost. Hover a bar to see how many of the rest couldn&apos;t be measured and why, and how many are missing because nothing was reported.
            </p>
            <UnmeasuredReasons reasons={trends.unmeasuredReasons} />
            {placed.length > 0 && (
              <ol className="mt-2.5 grid gap-1 text-[11px] text-muted-foreground">
                {markers.map((m) => (
                  <li key={m.date} className="flex gap-2">
                    <span className="flex h-4 w-4 flex-none items-center justify-center rounded-full border-[1.5px] text-[9px] font-bold" style={{ borderColor: "var(--tu-marker)", color: "var(--tu-marker)" }}>
                      {m.number}
                    </span>
                    <span>
                      <b className="font-medium text-foreground">{fmtDay(m.date)}</b> · {m.label}
                    </span>
                  </li>
                ))}
              </ol>
            )}
            <DataTable
              head={[grain === "week" ? "Week of" : "Day", "Opus", "Sonnet", "Other", "Total", "With a cost", "Couldn't measure", "Missing"]}
              rows={cost.map((b) => [fmtDay(b.start), money2(b.opus), money2(b.sonnet), money2(b.other), money2(b.total), `${b.costed} of ${b.finished}`, b.unmeasured, b.finished - b.costed - b.unmeasured])}
            />
          </>
        ) : (
          <p className="py-6 text-center text-xs text-muted-foreground">No cost recorded in this period.</p>
        )}
      </ChartCard>

      <div className="grid gap-4 min-[900px]:grid-cols-[3fr_2fr]">
        <ChartCard title="Typical cost of a finished run" note="median per week">
          {runCost.length > 0 ? (
            <>
              <div className="my-1.5 flex flex-wrap gap-x-3.5 gap-y-1 text-xs text-muted-foreground">
                {runCost.map((s, k) => (
                  <span key={s.name}>
                    <span className="mr-1.5 inline-block h-[3px] w-3.5 rounded align-middle" style={{ background: SERIES_COLORS[k] }} />
                    {s.name}
                  </span>
                ))}
              </div>
              <ChartContainer config={seriesConfig} className="aspect-auto h-[210px] w-full">
                <LineChart data={runRows} margin={{ top: 12, right: 10, left: 0, bottom: 4 }}>
                  <CartesianGrid vertical={false} />
                  <XAxis dataKey="start" tickLine={false} axisLine={false} interval="preserveStartEnd" minTickGap={4} tickFormatter={fmtDay} />
                  <YAxis width={44} tickLine={false} axisLine={false} tickFormatter={money} />
                  {weekMarkers.map((m) => (
                    <ReferenceLine key={m.date} x={m.at} stroke="var(--tu-marker)" strokeDasharray="3 3" strokeWidth={1} strokeOpacity={0.45} ifOverflow="visible" />
                  ))}
                  <ChartTooltip
                    content={({ active, payload }) => {
                      const row = active ? (payload?.[0]?.payload as Record<string, string | number | null> | undefined) : undefined;
                      if (!row) return null;
                      return (
                        <Tip>
                          <b className="font-semibold">Week of {fmtDay(String(row.start))}{row.partial ? " (so far)" : ""}</b>
                          {runCost.map((s, k) =>
                            row[`s${k}`] === null || row[`s${k}`] === undefined ? null : (
                              <div key={s.name}>
                                <Swatch color={SERIES_COLORS[k]} />
                                {s.name} {money2(Number(row[`s${k}`]))} · {row[`s${k}runs`]} finished run{row[`s${k}runs`] === 1 ? "" : "s"} with every step costed
                              </div>
                            )
                          )}
                        </Tip>
                      );
                    }}
                  />
                  {runCost.map((s, k) => (
                    <Line
                      key={s.name}
                      dataKey={`s${k}`}
                      type="linear"
                      stroke={SERIES_COLORS[k]}
                      strokeWidth={2}
                      connectNulls={false}
                      isAnimationActive={false}
                      dot={(p: { cx?: number; cy?: number; index?: number; payload?: Record<string, number | null> }) => {
                        const runs = Number(p.payload?.[`s${k}runs`] ?? 0);
                        if (p.cx === undefined || p.cy === undefined || p.payload?.[`s${k}`] == null) return <g key={`d${k}-${p.index}`} />;
                        const rough = runs < ROUGH_RUNS;
                        return (
                          <circle key={`d${k}-${p.index}`} cx={p.cx} cy={p.cy} r={4} strokeWidth={2} className={rough ? "fill-background" : undefined} fill={rough ? undefined : SERIES_COLORS[k]} stroke={rough ? SERIES_COLORS[k] : "var(--background)"} />
                        );
                      }}
                      activeDot={{ r: 5 }}
                    />
                  ))}
                </LineChart>
              </ChartContainer>
              <p className="mt-1.5 text-[11px] text-muted-foreground">
                Hollow dots: fewer than {ROUGH_RUNS} runs that week, so treat them as rough. Each workflow is drawn on its own because a big build slice and a small bug fix can&apos;t be averaged together sensibly.
              </p>
              <DataTable
                head={["Week of", ...runCost.map((s) => s.name)]}
                rows={weeks.map((w, i) => [fmtDay(w.start), ...runCost.map((s) => (s.points[i].median === null ? "—" : `${money2(s.points[i].median!)} (${s.points[i].runs})`))])}
              />
            </>
          ) : (
            <p className="py-6 text-center text-xs text-muted-foreground">No finished run has every step costed in this period.</p>
          )}
        </ChartCard>

        <ChartCard title="Runs sent back at least once" note="share of finished runs">
          {sentRows.some((s) => s.runs > 0) ? (
            <>
              <ChartContainer config={sentConfig} className="mt-2 aspect-auto h-[210px] w-full">
                <BarChart data={sentRows} margin={{ top: 12, right: 8, left: 0, bottom: 4 }}>
                  <CartesianGrid vertical={false} />
                  <XAxis dataKey="start" tickLine={false} axisLine={false} interval="preserveStartEnd" minTickGap={4} tickFormatter={fmtDay} />
                  <YAxis width={34} domain={[0, 1]} ticks={[0, 0.25, 0.5, 0.75, 1]} tickLine={false} axisLine={false} tickFormatter={(v: number) => `${v * 100}%`} />
                  <ChartTooltip
                    cursor={{ fill: "var(--muted)", opacity: 0.4 }}
                    content={({ active, payload }) => {
                      const s = active ? (payload?.[0]?.payload as (typeof sentRows)[number] | undefined) : undefined;
                      if (!s || s.share === null) return null;
                      return (
                        <Tip>
                          <b className="font-semibold">Week of {fmtDay(s.start)}{s.partial ? " (so far)" : ""}</b>
                          <br />
                          {s.sentBack} of {s.runs} finished runs sent back ({Math.round(s.share * 100)}%)
                        </Tip>
                      );
                    }}
                  />
                  <Bar isAnimationActive={false} dataKey="share" fill="var(--tu-share)" maxBarSize={30} radius={[4, 4, 0, 0]}>
                    {sentRows.map((s) => <Cell key={s.start} fill="var(--tu-share)" fillOpacity={s.partial ? 0.5 : 0.85} />)}
                  </Bar>
                </BarChart>
              </ChartContainer>
              <p className="mt-1.5 text-[11px] text-muted-foreground">
                So &quot;cheaper&quot; can&apos;t hide &quot;worse&quot;: if this climbs while cost falls, the saving is costing quality.
              </p>
              <DataTable
                head={["Week of", "Finished runs", "Sent back", "Share"]}
                rows={sentRows.map((s) => [fmtDay(s.start), s.runs, s.sentBack, s.share === null ? "—" : `${Math.round(s.share * 100)}%`])}
              />
            </>
          ) : (
            <p className="py-6 text-center text-xs text-muted-foreground">No finished runs in this period.</p>
          )}
        </ChartCard>
      </div>

      <div className="rounded-lg border px-4 py-3 text-xs text-muted-foreground">
        <b className="font-medium text-foreground">Not counted on this page.</b> Only workflow steps record their cost. These don&apos;t:
        <ul className="mt-1.5 list-disc space-y-0.5 pl-[18px]">
          <li>Chat in your terminal between cards, outside any workflow step.</li>
          <li>Codex steps, and steps finished in a different session from the one that started them.</li>
          <li>The app&apos;s own AI buttons. Those are on the In-app AI tab.</li>
          <li>Anything else that runs outside a workflow step.</li>
        </ul>
      </div>
    </section>
  );
}
