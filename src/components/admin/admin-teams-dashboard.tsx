"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, Pencil, Trash2, Eye, EyeOff, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { toast } from "sonner";
import {
  deleteFeaturedTeam,
  toggleFeaturedTeamActive,
} from "@/actions/admin-agents";
import { TeamEditorDialog } from "./team-editor-dialog";
import { cn, getInitials } from "@/lib/utils";
import type { FeaturedTeamWithAgents, BotProfile } from "@/types";

interface AdminTeamsDashboardProps {
  teams: FeaturedTeamWithAgents[];
  adminAgents: BotProfile[];
  communityAgents: BotProfile[];
  onRefresh: () => void;
}

export function AdminTeamsDashboard({
  teams,
  adminAgents,
  communityAgents,
  onRefresh,
}: AdminTeamsDashboardProps) {
  const router = useRouter();
  const [createOpen, setCreateOpen] = useState(false);
  const [editTeam, setEditTeam] = useState<FeaturedTeamWithAgents | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<FeaturedTeamWithAgents | null>(null);
  const [togglingId, setTogglingId] = useState<string | null>(null);

  async function handleDelete() {
    if (!deleteTarget) return;
    try {
      await deleteFeaturedTeam(deleteTarget.id);
      toast.success(`Team "${deleteTarget.name}" deleted`);
      setDeleteTarget(null);
      onRefresh();
      router.refresh();
    } catch {
      toast.error("Failed to delete team");
    }
  }

  async function handleToggleActive(team: FeaturedTeamWithAgents) {
    setTogglingId(team.id);
    try {
      await toggleFeaturedTeamActive(team.id);
      toast.success(
        team.is_active
          ? `Team "${team.name}" deactivated`
          : `Team "${team.name}" activated`
      );
      onRefresh();
      router.refresh();
    } catch {
      toast.error("Failed to toggle team status");
    } finally {
      setTogglingId(null);
    }
  }

  const MAX_VISIBLE_AGENTS = 3;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold">Featured Teams</h2>
          <p className="text-sm text-muted-foreground">
            {teams.length} team{teams.length !== 1 ? "s" : ""} configured
          </p>
        </div>
        <Button size="sm" onClick={() => setCreateOpen(true)}>
          <Plus className="mr-2 h-4 w-4" />
          Create Team
        </Button>
      </div>

      {/* Team Cards Grid */}
      {teams.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed p-12 text-center">
          <Users className="h-10 w-10 text-muted-foreground" />
          <div>
            <p className="text-sm font-medium">No featured teams yet</p>
            <p className="text-xs text-muted-foreground">
              Create a team to showcase curated agent groups in the community tab.
            </p>
          </div>
          <Button variant="outline" size="sm" onClick={() => setCreateOpen(true)}>
            <Plus className="mr-2 h-4 w-4" />
            Create your first team
          </Button>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {teams.map((team) => {
            const visibleAgents = team.agents.slice(0, MAX_VISIBLE_AGENTS);
            const extraCount = team.agents.length - MAX_VISIBLE_AGENTS;

            return (
              <div
                key={team.id}
                className={cn(
                  "group relative flex flex-col rounded-lg border bg-muted/30 transition-all",
                  team.is_active
                    ? "border-border"
                    : "border-border/50 opacity-50"
                )}
              >
                {/* Card Header */}
                <div className="flex items-start gap-3 p-4 pb-2">
                  <span className="text-2xl leading-none shrink-0">{team.icon}</span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="font-semibold text-sm truncate">
                        {team.name}
                      </span>
                      <Badge variant="secondary" className="text-[10px] shrink-0">
                        {team.agents.length} agent{team.agents.length !== 1 ? "s" : ""}
                      </Badge>
                    </div>
                    <Badge
                      variant={team.is_active ? "default" : "outline"}
                      className={cn(
                        "mt-1 text-[10px]",
                        team.is_active
                          ? "bg-emerald-500/15 text-emerald-500 hover:bg-emerald-500/25"
                          : "text-muted-foreground"
                      )}
                    >
                      {team.is_active ? "Active" : "Inactive"}
                    </Badge>
                  </div>
                </div>

                {/* Description */}
                {team.description && (
                  <p className="px-4 text-xs text-muted-foreground line-clamp-2 leading-snug">
                    {team.description}
                  </p>
                )}

                {/* Agent Avatars Preview */}
                <div className="flex flex-col gap-1.5 px-4 mt-3">
                  {visibleAgents.map((ta) => (
                    <div key={ta.id} className="flex items-center gap-2">
                      <Avatar className="h-5 w-5 shrink-0">
                        <AvatarImage src={ta.bot.avatar_url ?? undefined} />
                        <AvatarFallback className="bg-primary/10 text-[9px]">
                          {getInitials(ta.bot.name)}
                        </AvatarFallback>
                      </Avatar>
                      <span className="text-xs text-muted-foreground truncate">
                        {ta.bot.name}
                        {ta.bot.role && (
                          <span className="ml-1 text-muted-foreground/60">
                            -- {ta.bot.role}
                          </span>
                        )}
                      </span>
                    </div>
                  ))}
                  {extraCount > 0 && (
                    <span className="text-[11px] text-muted-foreground/70 pl-7">
                      +{extraCount} more
                    </span>
                  )}
                  {team.agents.length === 0 && (
                    <span className="text-xs text-muted-foreground/50 italic">
                      No agents assigned
                    </span>
                  )}
                </div>

                {/* Card Footer */}
                <div className="flex items-center justify-end gap-1.5 mt-auto border-t border-border/40 px-3 py-2.5 mt-3">
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7"
                    title={team.is_active ? "Deactivate" : "Activate"}
                    disabled={togglingId === team.id}
                    onClick={() => handleToggleActive(team)}
                  >
                    {team.is_active ? (
                      <EyeOff className="h-3.5 w-3.5" />
                    ) : (
                      <Eye className="h-3.5 w-3.5" />
                    )}
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7"
                    title="Edit"
                    onClick={() => setEditTeam(team)}
                  >
                    <Pencil className="h-3.5 w-3.5" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 text-destructive hover:text-destructive"
                    title="Delete"
                    onClick={() => setDeleteTarget(team)}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Create / Edit Dialog */}
      <TeamEditorDialog
        open={createOpen || !!editTeam}
        onOpenChange={(open) => {
          if (!open) {
            setCreateOpen(false);
            setEditTeam(null);
            onRefresh();
            router.refresh();
          }
        }}
        editTeam={editTeam}
        adminAgents={adminAgents}
        communityAgents={communityAgents}
      />

      {/* Delete Confirmation */}
      <AlertDialog
        open={!!deleteTarget}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete team?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete the team{" "}
              <strong>{deleteTarget?.name}</strong> and remove all its agent
              associations. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
