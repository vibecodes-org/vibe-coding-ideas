"use client";

import { useMemo } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  Activity,
  Coins,
  Cpu,
} from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatRelativeTime } from "@/lib/utils";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { UserCreditsTable } from "./user-credits-table";
import type { UsageLogWithUser, UserCreditInfo, PlatformLogEntry } from "@/app/(main)/admin/page";

interface AiUsageDashboardProps {
  usageLogs: UsageLogWithUser[];
  filters: { from: string; to: string; action: string; source: string };
  userCredits: UserCreditInfo[];
  allPlatformLogs: PlatformLogEntry[];
}

const ACTION_LABELS: Record<string, string> = {
  enhance_description: "Enhance Description",
  generate_questions: "Generate Questions",
  enhance_with_context: "Enhance with Context",
  generate_board_tasks: "Generate Board Tasks",
  enhance_task_description: "Enhance Task Description",
};

export function estimateCost(inputTokens: number, outputTokens: number): number {
  return (inputTokens * 3) / 1_000_000 + (outputTokens * 15) / 1_000_000;
}

export function AiUsageDashboard({
  usageLogs,
  filters,
  userCredits,
  allPlatformLogs,
}: AiUsageDashboardProps) {
  const router = useRouter();
  const searchParams = useSearchParams();

  function updateFilter(key: string, value: string) {
    const params = new URLSearchParams(searchParams.toString());
    if (value && value !== "all") {
      params.set(key, value);
    } else {
      params.delete(key);
    }
    // Remove feedback-specific params when updating AI usage filters
    params.delete("category");
    params.delete("status");
    params.delete("tab");
    router.push(`/admin?${params.toString()}`);
  }

  // Compute stats from all logs
  const stats = useMemo(() => {
    const now = new Date();
    const todayStart = new Date(now);
    todayStart.setUTCHours(0, 0, 0, 0);
    const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const monthAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

    let todayCalls = 0;
    let weekCalls = 0;
    let monthCalls = 0;
    let totalInputTokens = 0;
    let totalOutputTokens = 0;
    let platformInputTokens = 0;
    let platformOutputTokens = 0;

    for (const log of usageLogs) {
      const logDate = new Date(log.created_at);
      if (logDate >= todayStart) todayCalls++;
      if (logDate >= weekAgo) weekCalls++;
      if (logDate >= monthAgo) monthCalls++;
      totalInputTokens += log.input_tokens;
      totalOutputTokens += log.output_tokens;
      if (log.key_type === "platform") {
        platformInputTokens += log.input_tokens;
        platformOutputTokens += log.output_tokens;
      }
    }

    return {
      todayCalls,
      weekCalls,
      monthCalls,
      totalCalls: usageLogs.length,
      totalInputTokens,
      totalOutputTokens,
      totalTokens: totalInputTokens + totalOutputTokens,
      estimatedCost: estimateCost(totalInputTokens, totalOutputTokens),
      platformCost: estimateCost(platformInputTokens, platformOutputTokens),
    };
  }, [usageLogs]);

  return (
    <div className="space-y-6">
      {/* Filter Bar */}
      <div className="flex flex-wrap items-end gap-4 rounded-lg border p-4">
        <div className="space-y-1">
          <Label className="text-xs text-muted-foreground">From</Label>
          <Input
            type="date"
            value={filters.from}
            onChange={(e) => updateFilter("from", e.target.value)}
            className="h-8 w-40 text-xs"
          />
        </div>
        <div className="space-y-1">
          <Label className="text-xs text-muted-foreground">To</Label>
          <Input
            type="date"
            value={filters.to}
            onChange={(e) => updateFilter("to", e.target.value)}
            className="h-8 w-40 text-xs"
          />
        </div>
        <div className="space-y-1">
          <Label className="text-xs text-muted-foreground">Action</Label>
          <Select
            value={filters.action}
            onValueChange={(v) => updateFilter("action", v)}
          >
            <SelectTrigger className="h-8 w-48 text-xs">
              <SelectValue placeholder="All actions" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All actions</SelectItem>
              {Object.entries(ACTION_LABELS).map(([value, label]) => (
                <SelectItem key={value} value={value}>
                  {label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label className="text-xs text-muted-foreground">Source</Label>
          <Select
            value={filters.source}
            onValueChange={(v) => updateFilter("source", v)}
          >
            <SelectTrigger className="h-8 w-36 text-xs">
              <SelectValue placeholder="All sources" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All sources</SelectItem>
              <SelectItem value="platform">Platform</SelectItem>
              <SelectItem value="byok">BYOK</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Stats Cards */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <StatCard
          icon={<Activity className="h-4 w-4" />}
          label="Total Calls"
          value={stats.totalCalls.toString()}
          detail={`Today: ${stats.todayCalls} / 7d: ${stats.weekCalls} / 30d: ${stats.monthCalls}`}
        />
        <StatCard
          icon={<Cpu className="h-4 w-4" />}
          label="Total Tokens"
          value={formatNumber(stats.totalTokens)}
          detail={`In: ${formatNumber(stats.totalInputTokens)} / Out: ${formatNumber(stats.totalOutputTokens)}`}
        />
        <StatCard
          icon={<Coins className="h-4 w-4" />}
          label="Est. Cost"
          value={`$${stats.estimatedCost.toFixed(2)}`}
          detail={`Platform: $${stats.platformCost.toFixed(2)} / BYOK: $${(stats.estimatedCost - stats.platformCost).toFixed(2)}`}
        />
      </div>

      {/* Recent Activity */}
      <div>
        <h2 className="mb-3 text-lg font-semibold">Recent Activity</h2>
        <div className="max-h-[400px] overflow-y-auto rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>User</TableHead>
                <TableHead>Action</TableHead>
                <TableHead>Source</TableHead>
                <TableHead className="text-right">Tokens</TableHead>
                <TableHead>Time</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {usageLogs.map((log) => (
                <TableRow key={log.id}>
                  <td className="p-2">
                    <div className="flex items-center gap-2">
                      <Avatar className="h-5 w-5">
                        <AvatarImage
                          src={log.user?.avatar_url ?? undefined}
                        />
                        <AvatarFallback className="text-[9px]">
                          {log.user?.full_name?.[0]?.toUpperCase() ?? "?"}
                        </AvatarFallback>
                      </Avatar>
                      <span className="text-xs">
                        {log.user?.full_name ?? log.user?.email ?? "Unknown"}
                      </span>
                    </div>
                  </td>
                  <td className="p-2">
                    <span className="text-xs">
                      {ACTION_LABELS[log.action_type] ?? log.action_type}
                    </span>
                  </td>
                  <td className="p-2">
                    <span className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-medium ${
                      log.key_type === "platform"
                        ? "bg-amber-500/10 text-amber-500"
                        : "bg-emerald-500/10 text-emerald-500"
                    }`}>
                      {log.key_type === "platform" ? "Platform" : "BYOK"}
                    </span>
                  </td>
                  <td className="p-2 text-right">
                    <span className="text-xs text-muted-foreground">
                      {formatNumber(log.input_tokens + log.output_tokens)}
                    </span>
                  </td>
                  <td className="p-2">
                    <span className="text-xs text-muted-foreground">
                      {formatRelativeTime(log.created_at)}
                    </span>
                  </td>
                </TableRow>
              ))}
              {usageLogs.length === 0 && (
                <TableRow>
                  <td colSpan={5} className="p-8 text-center text-sm text-muted-foreground">
                    No AI usage recorded yet.
                  </td>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      </div>

      {/* User Credits & Platform Costs — all-time, not affected by filters */}
      <UserCreditsTable userCredits={userCredits} allPlatformLogs={allPlatformLogs} />
    </div>
  );
}

function StatCard({
  icon,
  label,
  value,
  detail,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  detail: string;
}) {
  return (
    <div className="rounded-lg border p-4">
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        {icon}
        {label}
      </div>
      <p className="mt-1 text-2xl font-bold">{value}</p>
      <p className="mt-0.5 text-xs text-muted-foreground">{detail}</p>
    </div>
  );
}

function formatNumber(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toString();
}
