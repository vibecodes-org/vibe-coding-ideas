"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Gift } from "lucide-react";
import { toast } from "sonner";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { estimateCost } from "./ai-usage-dashboard";
import { grantStarterCredits } from "@/actions/admin";
import type { PlatformLogEntry, UserCreditInfo } from "@/app/(main)/admin/page";

interface UserCreditsTableProps {
  userCredits: UserCreditInfo[];
  allPlatformLogs: PlatformLogEntry[];
}

interface UserStats {
  platformCalls: number;
  platformInputTokens: number;
  platformOutputTokens: number;
  creditsUsed: number;
}

export function UserCreditsTable({ userCredits, allPlatformLogs }: UserCreditsTableProps) {
  const router = useRouter();

  // Compute per-user platform stats from all-time platform logs (unfiltered)
  const userStatsMap = useMemo(() => {
    const map = new Map<string, UserStats>();
    for (const log of allPlatformLogs) {
      const existing = map.get(log.user_id);
      if (existing) {
        existing.platformCalls++;
        existing.platformInputTokens += log.input_tokens;
        existing.platformOutputTokens += log.output_tokens;
        existing.creditsUsed++;
      } else {
        map.set(log.user_id, {
          platformCalls: 1,
          platformInputTokens: log.input_tokens,
          platformOutputTokens: log.output_tokens,
          creditsUsed: 1,
        });
      }
    }
    return map;
  }, [allPlatformLogs]);

  // Show all non-bot users
  const filteredUsers = userCredits;

  // Summary stats
  const summary = useMemo(() => {
    let usersWithCredits = 0;
    let totalPlatformCost = 0;
    for (const u of filteredUsers) {
      if (u.ai_starter_credits > 0) usersWithCredits++;
      const stats = userStatsMap.get(u.id);
      if (stats) {
        totalPlatformCost += estimateCost(stats.platformInputTokens, stats.platformOutputTokens);
      }
    }
    return { usersWithCredits, totalPlatformCost };
  }, [userCredits, userStatsMap]);

  if (filteredUsers.length === 0) return null;

  return (
    <div>
      <div className="mb-3 flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold">User Credits &amp; Platform Costs</h2>
          <p className="text-xs text-muted-foreground">All-time — not affected by filters above</p>
        </div>
        <p className="text-xs text-muted-foreground">
          {summary.usersWithCredits} user{summary.usersWithCredits !== 1 ? "s" : ""} with credits remaining / ${summary.totalPlatformCost.toFixed(2)} total platform cost
        </p>
      </div>
      <div className="max-h-[400px] overflow-y-auto rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>User</TableHead>
              <TableHead className="text-right">Credits Left</TableHead>
              <TableHead className="text-right">Credits Used</TableHead>
              <TableHead className="text-right">Platform Calls</TableHead>
              <TableHead className="text-right">Est. Cost</TableHead>
              <TableHead>Key Type</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filteredUsers.map((user) => {
              const stats = userStatsMap.get(user.id);
              const cost = stats
                ? estimateCost(stats.platformInputTokens, stats.platformOutputTokens)
                : 0;

              return (
                <TableRow key={user.id}>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <Avatar className="h-5 w-5">
                        <AvatarImage src={user.avatar_url ?? undefined} />
                        <AvatarFallback className="text-[9px]">
                          {user.full_name?.[0]?.toUpperCase() ?? "?"}
                        </AvatarFallback>
                      </Avatar>
                      <span className="text-xs">
                        {user.full_name ?? user.email}
                      </span>
                    </div>
                  </TableCell>
                  <TableCell className="text-right text-xs">
                    {user.ai_starter_credits}
                  </TableCell>
                  <TableCell className="text-right text-xs">
                    {stats?.creditsUsed ?? 0}
                  </TableCell>
                  <TableCell className="text-right text-xs">
                    {stats?.platformCalls ?? 0}
                  </TableCell>
                  <TableCell className="text-right text-xs text-muted-foreground">
                    ${cost.toFixed(4)}
                  </TableCell>
                  <TableCell>
                    {user.encrypted_anthropic_key ? (
                      <Badge variant="outline" className="text-[10px] text-emerald-500 border-emerald-500/30">
                        BYOK
                      </Badge>
                    ) : (
                      <Badge variant="outline" className="text-[10px] text-amber-500 border-amber-500/30">
                        Platform
                      </Badge>
                    )}
                  </TableCell>
                  <TableCell className="text-right">
                    <GrantCreditsButton
                      userId={user.id}
                      userName={user.full_name ?? user.email}
                      onGranted={() => router.refresh()}
                    />
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

function GrantCreditsButton({
  userId,
  userName,
  onGranted,
}: {
  userId: string;
  userName: string;
  onGranted: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [credits, setCredits] = useState("5");
  const [loading, setLoading] = useState(false);

  async function handleGrant() {
    const amount = parseInt(credits, 10);
    if (!amount || amount < 1 || amount > 100) {
      toast.error("Enter a number between 1 and 100");
      return;
    }
    setLoading(true);
    try {
      await grantStarterCredits(userId, amount);
      toast.success(`Granted ${amount} credits to ${userName}`);
      setOpen(false);
      onGranted();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to grant credits");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="sm" className="h-7 gap-1 text-xs">
          <Gift className="h-3 w-3" />
          Grant
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Grant Credits</DialogTitle>
          <DialogDescription>
            Add AI starter credits for {userName}.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2 py-2">
          <Label htmlFor="credit-amount">Number of credits (1-100)</Label>
          <Input
            id="credit-amount"
            type="number"
            min={1}
            max={100}
            value={credits}
            onChange={(e) => setCredits(e.target.value)}
          />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button onClick={handleGrant} disabled={loading}>
            {loading ? "Granting..." : "Grant Credits"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
