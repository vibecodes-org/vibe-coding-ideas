"use client";

import { useState, useMemo } from "react";
import { Bot } from "lucide-react";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip";
import { formatRelativeTime, cn } from "@/lib/utils";

export type McpToolLogWithUser = {
  id: string;
  tool_name: string;
  user_id: string;
  owner_user_id: string | null;
  duration_ms: number;
  is_error: boolean;
  mode: string;
  idea_id: string | null;
  created_at: string;
  user?: { full_name: string | null; avatar_url: string | null; is_bot: boolean } | null;
};

export type McpToolStatsRow = {
  tool_name: string;
  user_id: string;
  call_count: number;
  error_count: number;
  avg_duration_ms: number;
  max_duration_ms: number;
  user?: { full_name: string | null; avatar_url: string | null; is_bot: boolean } | null;
};

interface AdminMcpToolsDashboardProps {
  recentLogs: McpToolLogWithUser[];
  stats: McpToolStatsRow[];
  allToolNames?: string[];
}

export function AdminMcpToolsDashboard({ recentLogs, stats, allToolNames }: AdminMcpToolsDashboardProps) {
  const [view, setView] = useState<"recent" | "trends">("recent");
  const [toolFilter, setToolFilter] = useState("");

  // --- Recent Activity stats ---
  const recentStats = useMemo(() => {
    const now = new Date();
    const todayStart = new Date(now);
    todayStart.setUTCHours(0, 0, 0, 0);

    let todayCalls = 0;
    let todayErrors = 0;
    let totalDuration = 0;
    const activeUsers = new Set<string>();

    for (const log of recentLogs) {
      const logDate = new Date(log.created_at);
      if (logDate >= todayStart) {
        todayCalls++;
        if (log.is_error) todayErrors++;
      }
      totalDuration += log.duration_ms;
      activeUsers.add(log.user_id);
    }

    const errorRate = recentLogs.length > 0
      ? ((recentLogs.filter((l) => l.is_error).length / recentLogs.length) * 100)
      : 0;
    const avgLatency = recentLogs.length > 0
      ? Math.round(totalDuration / recentLogs.length)
      : 0;

    return {
      todayCalls,
      errorRate,
      avgLatency,
      activeUsers: activeUsers.size,
    };
  }, [recentLogs]);

  // --- Trends stats ---
  const trendsStats = useMemo(() => {
    const totalCalls = stats.reduce((sum, s) => sum + s.call_count, 0);
    const uniqueTools = new Set(stats.map((s) => s.tool_name)).size;

    // Most used tool
    const toolCalls = new Map<string, number>();
    const toolErrors = new Map<string, number>();
    for (const s of stats) {
      toolCalls.set(s.tool_name, (toolCalls.get(s.tool_name) ?? 0) + s.call_count);
      toolErrors.set(s.tool_name, (toolErrors.get(s.tool_name) ?? 0) + s.error_count);
    }

    let mostUsedTool = "N/A";
    let mostUsedCount = 0;
    for (const [tool, count] of toolCalls) {
      if (count > mostUsedCount) {
        mostUsedTool = tool;
        mostUsedCount = count;
      }
    }

    // Highest error rate tool (min 5 calls)
    let highestErrorTool = "N/A";
    let highestErrorRate = 0;
    for (const [tool, calls] of toolCalls) {
      if (calls < 5) continue;
      const errors = toolErrors.get(tool) ?? 0;
      const rate = (errors / calls) * 100;
      if (rate > highestErrorRate) {
        highestErrorRate = rate;
        highestErrorTool = tool;
      }
    }

    return {
      totalCalls,
      uniqueTools,
      mostUsedTool,
      highestErrorTool,
      highestErrorRate,
    };
  }, [stats]);

  // --- Aggregated tool stats for Trends view ---
  const toolAggregates = useMemo(() => {
    const map = new Map<string, { calls: number; errors: number; totalDuration: number; maxDuration: number; count: number }>();
    for (const s of stats) {
      const existing = map.get(s.tool_name);
      if (existing) {
        existing.calls += s.call_count;
        existing.errors += s.error_count;
        existing.totalDuration += s.avg_duration_ms * s.call_count;
        existing.maxDuration = Math.max(existing.maxDuration, s.max_duration_ms);
        existing.count += s.call_count;
      } else {
        map.set(s.tool_name, {
          calls: s.call_count,
          errors: s.error_count,
          totalDuration: s.avg_duration_ms * s.call_count,
          maxDuration: s.max_duration_ms,
          count: s.call_count,
        });
      }
    }
    return Array.from(map.entries())
      .map(([tool, data]) => ({
        tool_name: tool,
        total_calls: data.calls,
        errors: data.errors,
        error_rate: data.calls > 0 ? (data.errors / data.calls) * 100 : 0,
        avg_duration: data.count > 0 ? Math.round(data.totalDuration / data.count) : 0,
        max_duration: data.maxDuration,
      }))
      .sort((a, b) => b.total_calls - a.total_calls);
  }, [stats]);

  // --- Aggregated user stats for Trends view ---
  const userAggregates = useMemo(() => {
    const map = new Map<string, {
      user_id: string;
      user: McpToolStatsRow["user"];
      calls: number;
      errors: number;
      toolCalls: Map<string, number>;
    }>();
    for (const s of stats) {
      const existing = map.get(s.user_id);
      if (existing) {
        existing.calls += s.call_count;
        existing.errors += s.error_count;
        existing.toolCalls.set(s.tool_name, (existing.toolCalls.get(s.tool_name) ?? 0) + s.call_count);
      } else {
        const toolCalls = new Map<string, number>();
        toolCalls.set(s.tool_name, s.call_count);
        map.set(s.user_id, {
          user_id: s.user_id,
          user: s.user,
          calls: s.call_count,
          errors: s.error_count,
          toolCalls,
        });
      }
    }
    return Array.from(map.values())
      .map((data) => {
        let mostUsedTool = "N/A";
        let mostUsedCount = 0;
        for (const [tool, count] of data.toolCalls) {
          if (count > mostUsedCount) {
            mostUsedTool = tool;
            mostUsedCount = count;
          }
        }
        return {
          user_id: data.user_id,
          user: data.user,
          total_calls: data.calls,
          errors: data.errors,
          most_used_tool: mostUsedTool,
        };
      })
      .sort((a, b) => b.total_calls - a.total_calls);
  }, [stats]);

  // --- Filtered recent logs ---
  const filteredLogs = useMemo(() => {
    if (!toolFilter.trim()) return recentLogs;
    const q = toolFilter.toLowerCase();
    return recentLogs.filter((log) => log.tool_name.toLowerCase().includes(q));
  }, [recentLogs, toolFilter]);

  return (
    <div className="space-y-6">
      {/* Segmented Control */}
      <div className="flex gap-1 rounded-lg bg-muted p-1">
        <button
          onClick={() => setView("recent")}
          className={cn(
            "rounded-md px-3 py-1.5 text-xs font-medium transition-colors",
            view === "recent"
              ? "bg-background text-foreground shadow-sm"
              : "text-muted-foreground hover:text-foreground"
          )}
        >
          Recent Activity
        </button>
        <button
          onClick={() => setView("trends")}
          className={cn(
            "rounded-md px-3 py-1.5 text-xs font-medium transition-colors",
            view === "trends"
              ? "bg-background text-foreground shadow-sm"
              : "text-muted-foreground hover:text-foreground"
          )}
        >
          Trends
        </button>
      </div>

      {view === "recent" ? (
        <>
          {/* Stat Cards */}
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard label="Today's Calls" value={recentStats.todayCalls.toString()} />
            <StatCard label="Error Rate" value={`${recentStats.errorRate.toFixed(1)}%`} />
            <StatCard label="Avg Latency" value={`${recentStats.avgLatency}ms`} />
            <StatCard label="Active Users" value={recentStats.activeUsers.toString()} />
          </div>

          {/* Filter */}
          <div>
            <Input
              placeholder="Filter by tool name..."
              value={toolFilter}
              onChange={(e) => setToolFilter(e.target.value)}
              className="h-8 max-w-sm text-xs"
            />
          </div>

          {/* Recent Logs Table */}
          <div className="max-h-[500px] overflow-y-auto rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Tool Name</TableHead>
                  <TableHead>User / Agent</TableHead>
                  <TableHead>Duration</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Mode</TableHead>
                  <TableHead>Time</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredLogs.map((log) => (
                  <TableRow key={log.id}>
                    <TableCell>
                      <span className="font-mono text-xs">{log.tool_name}</span>
                    </TableCell>
                    <TableCell>
                      <UserCell user={log.user} />
                    </TableCell>
                    <TableCell>
                      <DurationBadge ms={log.duration_ms} />
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1.5">
                        <span
                          className={cn(
                            "h-2 w-2 rounded-full",
                            log.is_error ? "bg-red-500" : "bg-green-500"
                          )}
                        />
                        <span className="text-xs text-muted-foreground">
                          {log.is_error ? "Error" : "OK"}
                        </span>
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" className="text-[10px]">
                        {log.mode}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <span className="text-xs text-muted-foreground">
                        {formatRelativeTime(log.created_at)}
                      </span>
                    </TableCell>
                  </TableRow>
                ))}
                {filteredLogs.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={6} className="p-8 text-center text-sm text-muted-foreground">
                      No MCP tool calls recorded yet.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </>
      ) : (
        <>
          {/* Trends Stat Cards */}
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard label="Total Calls" value={trendsStats.totalCalls.toString()} />
            <StatCard label="Unique Tools" value={trendsStats.uniqueTools.toString()} />
            <StatCard label="Most Used Tool" value={trendsStats.mostUsedTool} />
            <StatCard
              label="Highest Error Rate"
              value={
                trendsStats.highestErrorTool === "N/A"
                  ? "N/A"
                  : `${trendsStats.highestErrorTool} (${trendsStats.highestErrorRate.toFixed(1)}%)`
              }
            />
          </div>

          {/* Top Tools Table */}
          <div>
            <h2 className="mb-3 text-lg font-semibold">Top Tools</h2>
            <div className="max-h-[500px] overflow-y-auto rounded-lg border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Tool Name</TableHead>
                    <TableHead className="text-right">Total Calls</TableHead>
                    <TableHead className="text-right">Errors</TableHead>
                    <TableHead className="text-right">Error Rate</TableHead>
                    <TableHead className="text-right">Avg Duration</TableHead>
                    <TableHead className="text-right">Max Duration</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {toolAggregates.map((row) => (
                    <TableRow key={row.tool_name}>
                      <TableCell>
                        <span className="font-mono text-xs">{row.tool_name}</span>
                      </TableCell>
                      <TableCell className="text-right text-xs">{row.total_calls}</TableCell>
                      <TableCell className="text-right text-xs">{row.errors}</TableCell>
                      <TableCell className="text-right">
                        <span
                          className={cn(
                            "text-xs",
                            row.error_rate > 5 ? "text-red-500 font-medium" : "text-muted-foreground"
                          )}
                        >
                          {row.error_rate.toFixed(1)}%
                        </span>
                      </TableCell>
                      <TableCell className="text-right">
                        <DurationBadge ms={row.avg_duration} />
                      </TableCell>
                      <TableCell className="text-right">
                        <DurationBadge ms={row.max_duration} />
                      </TableCell>
                    </TableRow>
                  ))}
                  {toolAggregates.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={6} className="p-8 text-center text-sm text-muted-foreground">
                        No tool stats available.
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </div>
          </div>

          {/* Least Used Tools Table */}
          {(() => {
            const usedToolNames = new Set(toolAggregates.map((t) => t.tool_name));
            const neverUsed = (allToolNames ?? [])
              .filter((name) => !usedToolNames.has(name))
              .map((name) => ({
                tool_name: name,
                total_calls: 0,
                errors: 0,
                error_rate: 0,
                avg_duration: 0,
                max_duration: 0,
              }));
            const leastUsed = [
              ...neverUsed,
              ...[...toolAggregates].sort((a, b) => a.total_calls - b.total_calls).slice(0, 10),
            ];
            return (
              <div>
                <h2 className="mb-3 text-lg font-semibold">
                  Least Used Tools
                  {neverUsed.length > 0 && (
                    <span className="ml-2 text-sm font-normal text-amber-500">
                      {neverUsed.length} never invoked
                    </span>
                  )}
                </h2>
                <div className="max-h-[500px] overflow-y-auto rounded-lg border">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Tool Name</TableHead>
                        <TableHead className="text-right">Total Calls</TableHead>
                        <TableHead className="text-right">Errors</TableHead>
                        <TableHead className="text-right">Error Rate</TableHead>
                        <TableHead className="text-right">Avg Duration</TableHead>
                        <TableHead className="text-right">Max Duration</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {leastUsed.map((row) => (
                        <TableRow key={row.tool_name} className={row.total_calls === 0 ? "bg-amber-500/10" : row.total_calls <= 2 ? "bg-amber-500/5" : undefined}>
                          <TableCell>
                            <span className="font-mono text-xs">{row.tool_name}</span>
                          </TableCell>
                          <TableCell className={cn("text-right text-xs", row.total_calls === 0 ? "text-amber-500 font-bold" : row.total_calls <= 2 ? "text-amber-500 font-medium" : "")}>
                            {row.total_calls}
                          </TableCell>
                          <TableCell className="text-right text-xs">{row.errors}</TableCell>
                          <TableCell className="text-right">
                            <span
                              className={cn(
                                "text-xs",
                                row.error_rate > 5 ? "text-red-500 font-medium" : "text-muted-foreground"
                              )}
                            >
                              {row.error_rate.toFixed(1)}%
                            </span>
                          </TableCell>
                          <TableCell className="text-right">
                            {row.total_calls === 0 ? <span className="text-xs text-muted-foreground">—</span> : <DurationBadge ms={row.avg_duration} />}
                          </TableCell>
                          <TableCell className="text-right">
                            {row.total_calls === 0 ? <span className="text-xs text-muted-foreground">—</span> : <DurationBadge ms={row.max_duration} />}
                          </TableCell>
                        </TableRow>
                      ))}
                      {leastUsed.length === 0 && (
                        <TableRow>
                          <TableCell colSpan={6} className="p-8 text-center text-sm text-muted-foreground">
                            No tool stats available.
                          </TableCell>
                        </TableRow>
                      )}
                    </TableBody>
                  </Table>
                </div>
              </div>
            );
          })()}

          {/* Per-User Table */}
          <div>
            <h2 className="mb-3 text-lg font-semibold">Per-User Breakdown</h2>
            <div className="max-h-[400px] overflow-y-auto rounded-lg border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>User / Agent</TableHead>
                    <TableHead className="text-right">Total Calls</TableHead>
                    <TableHead className="text-right">Errors</TableHead>
                    <TableHead>Most Used Tool</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {userAggregates.map((row) => (
                    <TableRow key={row.user_id}>
                      <TableCell>
                        <UserCell user={row.user} />
                      </TableCell>
                      <TableCell className="text-right text-xs">{row.total_calls}</TableCell>
                      <TableCell className="text-right text-xs">{row.errors}</TableCell>
                      <TableCell>
                        <span className="font-mono text-xs">{row.most_used_tool}</span>
                      </TableCell>
                    </TableRow>
                  ))}
                  {userAggregates.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={4} className="p-8 text-center text-sm text-muted-foreground">
                        No user stats available.
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border bg-card p-4">
      <p className="text-xs uppercase text-muted-foreground">{label}</p>
      <p className="mt-1 text-2xl font-bold">{value}</p>
    </div>
  );
}

function UserCell({
  user,
}: {
  user?: { full_name: string | null; avatar_url: string | null; is_bot: boolean } | null;
}) {
  return (
    <div className="flex items-center gap-2">
      <Avatar className="h-5 w-5">
        <AvatarImage src={user?.avatar_url ?? undefined} />
        <AvatarFallback className="text-[9px]">
          {user?.full_name?.[0]?.toUpperCase() ?? "?"}
        </AvatarFallback>
      </Avatar>
      <span className="text-xs">{user?.full_name ?? "Unknown"}</span>
      {user?.is_bot && (
        <Tooltip>
          <TooltipTrigger asChild>
            <Bot className="h-3 w-3 text-primary cursor-help" />
          </TooltipTrigger>
          <TooltipContent>Agent</TooltipContent>
        </Tooltip>
      )}
    </div>
  );
}

function DurationBadge({ ms }: { ms: number }) {
  return (
    <span
      className={cn(
        "text-xs font-medium",
        ms < 100 ? "text-green-500" : ms < 500 ? "text-amber-500" : "text-red-500"
      )}
    >
      {ms}ms
    </span>
  );
}
