"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { toast } from "sonner";
import {
  ArrowRight,
  MessageSquare,
  CheckCircle2,
  Lightbulb,
  ExternalLink,
  FileDown,
  Zap,
  Plus,
  X,
  Package,
} from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { AgentVoteButton } from "./agent-vote-button";
import { CloneAgentButton } from "./clone-agent-button";
import { EditAgentDialog } from "./edit-agent-dialog";
import { ExportSkillDialog } from "./export-skill-dialog";
import { AddSkillDialog } from "./add-skill-dialog";
import { parsePromptToFields } from "@/lib/prompt-builder";
import { cn, getInitials } from "@/lib/utils";
import { getRoleColor } from "@/lib/agent-colors";
import { removeSkillFromAgent } from "@/actions/bots";
import type { BotProfile, AgentSkill } from "@/types";

interface ActivityItem {
  id: string;
  action: string;
  details: Record<string, string> | null;
  created_at: string;
  taskTitle: string;
}

interface AgentProfileProps {
  bot: BotProfile & {
    owner: { id: string; full_name: string | null; avatar_url: string | null };
  };
  isOwner: boolean;
  hasVoted: boolean;
  tasks: Array<{
    id: string;
    title: string;
    archived: boolean;
    board_columns: { title: string; is_done_column: boolean; idea_id: string };
  }>;
  completedTaskCount: number;
  contributingIdeas: Array<{ id: string; title: string; assignedCount: number }>;
  recentActivity: ActivityItem[];
  clonedFromBot: { id: string; name: string } | null;
  agentSkills: AgentSkill[];
}

function formatRelativeTime(dateStr: string) {
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMin = Math.floor(diffMs / 60000);
  if (diffMin < 1) return "just now";
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHours = Math.floor(diffMin / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  const diffDays = Math.floor(diffHours / 24);
  if (diffDays === 1) return "Yesterday";
  if (diffDays < 7) return `${diffDays}d ago`;
  return date.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

function getActivityIcon(action: string) {
  if (action === "moved") return { icon: ArrowRight, className: "bg-blue-500/15 text-blue-500" };
  if (action === "comment_added") return { icon: MessageSquare, className: "bg-emerald-500/15 text-emerald-500" };
  return { icon: CheckCircle2, className: "bg-violet-500/15 text-violet-400" };
}

export function AgentProfile({
  bot,
  isOwner,
  hasVoted,
  tasks,
  completedTaskCount,
  contributingIdeas,
  recentActivity,
  clonedFromBot,
  agentSkills,
}: AgentProfileProps) {
  const [editOpen, setEditOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [addSkillOpen, setAddSkillOpen] = useState(false);
  const [removingSkillId, setRemovingSkillId] = useState<string | null>(null);
  const router = useRouter();

  const initials = getInitials(bot.name);

  const colors = getRoleColor(bot.role);

  const promptFields =
    bot.is_published || isOwner
      ? parsePromptToFields(bot.system_prompt ?? "")
      : null;

  const createdDate = new Date(bot.created_at).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });

  return (
    <div className="space-y-6">
      {/* Breadcrumb */}
      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <Link
          href="/agents"
          className="text-violet-400 hover:underline"
        >
          Agents Hub
        </Link>
        <span>/</span>
        <span>{bot.name}</span>
      </div>

      {/* Hero */}
      <div className="flex gap-6 pb-6 border-b border-border">
        {/* Avatar + status */}
        <div className="shrink-0 text-center">
          <Avatar className="h-20 w-20 mb-2">
            <AvatarImage src={bot.avatar_url ?? undefined} />
            <AvatarFallback className={cn("text-2xl", colors.avatarBg, colors.avatarText)}>
              {initials}
            </AvatarFallback>
          </Avatar>
          <div className="flex items-center justify-center gap-1">
            <div
              className={cn(
                "h-2 w-2 rounded-full",
                bot.is_active ? "bg-emerald-500" : "bg-muted-foreground"
              )}
            />
            <span
              className={cn(
                "text-[10px] font-medium",
                bot.is_active ? "text-emerald-400" : "text-muted-foreground"
              )}
            >
              {bot.is_active ? "Active" : "Inactive"}
            </span>
          </div>
        </div>

        {/* Info */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <h1 className="text-xl font-bold truncate">{bot.name}</h1>
            {bot.role && (
              <Badge className={cn("text-xs shrink-0 border-0", colors.badge)}>
                {bot.role}
              </Badge>
            )}
          </div>

          {bot.bio && (
            <p className="text-sm text-muted-foreground italic mb-2">
              &ldquo;{bot.bio}&rdquo;
            </p>
          )}

          {/* Metadata line */}
          <div className="flex items-center gap-2 flex-wrap text-xs text-muted-foreground mb-2">
            <span>
              Owned by{" "}
              <Link
                href={`/profile/${bot.owner.id}`}
                className="font-medium text-muted-foreground/80 hover:underline"
              >
                {bot.owner.full_name ?? "Unknown"}
              </Link>
            </span>
            <span className="text-[8px]">&#x2022;</span>
            <span>Created {createdDate}</span>
            {bot.is_published && (
              <>
                <span className="text-[8px]">&#x2022;</span>
                <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/15 px-1.5 py-px text-[10px] font-medium text-emerald-500">
                  &#x1F310; Published
                </span>
              </>
            )}
          </div>

          {clonedFromBot && (
            <p className="text-xs text-muted-foreground mb-2">
              Cloned from{" "}
              <Link
                href={`/agents/${clonedFromBot.id}`}
                className="text-primary hover:underline"
              >
                {clonedFromBot.name}
              </Link>
            </p>
          )}

          {/* Skills */}
          {bot.skills && bot.skills.length > 0 && (
            <div className="flex flex-wrap gap-1 mt-2">
              {bot.skills.map((skill) => (
                <span
                  key={skill}
                  className="rounded-full border border-border/50 bg-background/50 px-2 py-px text-[10px] font-medium text-muted-foreground"
                >
                  {skill}
                </span>
              ))}
            </div>
          )}
        </div>

        {/* Actions */}
        <div className="shrink-0 flex gap-2 self-start">
          {isOwner ? (
            <>
              <Button
                variant="outline"
                size="sm"
                className="text-xs"
                onClick={() => setExportOpen(true)}
              >
                <FileDown className="mr-1.5 h-3.5 w-3.5" />
                Export as Skill
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="text-xs"
                onClick={() => setEditOpen(true)}
              >
                Edit Profile
              </Button>
            </>
          ) : (
            <>
              <AgentVoteButton
                botId={bot.id}
                upvotes={bot.community_upvotes}
                hasVoted={hasVoted}
              />
              <CloneAgentButton botId={bot.id} botName={bot.name} />
            </>
          )}
        </div>
      </div>

      {/* Stats grid */}
      <div className="grid grid-cols-4 gap-3">
        <div className="rounded-lg border border-border bg-muted/30 p-3.5 text-center">
          <p className="text-xl font-bold text-violet-400">{completedTaskCount}</p>
          <p className="text-[10px] text-muted-foreground">Tasks Completed</p>
        </div>
        <div className="rounded-lg border border-border bg-muted/30 p-3.5 text-center">
          <p className="text-xl font-bold text-blue-500">{tasks.length}</p>
          <p className="text-[10px] text-muted-foreground">Currently Assigned</p>
        </div>
        <div className="rounded-lg border border-border bg-muted/30 p-3.5 text-center">
          <p className="text-xl font-bold text-emerald-500">{contributingIdeas.length}</p>
          <p className="text-[10px] text-muted-foreground">Active Ideas</p>
        </div>
        <div className="rounded-lg border border-border bg-muted/30 p-3.5 text-center">
          <p className="text-xl font-bold text-amber-500">{bot.community_upvotes}</p>
          <p className="text-[10px] text-muted-foreground">Community Upvotes</p>
        </div>
      </div>

      {/* Personality & Instructions */}
      {promptFields && (promptFields.goal || promptFields.expertise || promptFields.constraints || promptFields.approach) && (
        <>
          <h2 className="text-sm font-semibold flex items-center gap-2">
            &#x1F9E0; Personality & Instructions
          </h2>
          <div className="flex flex-col gap-3">
            {/* Goal — full width */}
            {promptFields.goal && (
              <div className="rounded-lg border border-border bg-muted/30 overflow-hidden">
                <div className="flex items-center gap-2 px-3.5 py-2.5 border-b border-border/50 text-xs font-semibold text-emerald-500">
                  &#x1F3AF; Goal
                </div>
                <div className="px-3.5 py-3 text-xs text-muted-foreground leading-relaxed">
                  {promptFields.goal}
                </div>
              </div>
            )}
            {/* Expertise — full width, bullet points */}
            {promptFields.expertise && (
              <div className="rounded-lg border border-border bg-muted/30 overflow-hidden">
                <div className="flex items-center gap-2 px-3.5 py-2.5 border-b border-border/50 text-xs font-semibold text-violet-500">
                  &#x1F4A1; Expertise
                </div>
                <div className="px-3.5 py-3 text-xs text-muted-foreground leading-relaxed">
                  <ul className="list-none space-y-2">
                    {promptFields.expertise.split("\n").filter(l => l.trim().startsWith("- ")).map((line, i) => (
                      <li key={i} className="flex gap-2">
                        <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-violet-500/50" />
                        <span>{line.replace(/^- /, "")}</span>
                      </li>
                    ))}
                  </ul>
                  {/* Fallback for non-bullet expertise */}
                  {!promptFields.expertise.includes("\n- ") && (
                    <span>{promptFields.expertise}</span>
                  )}
                </div>
              </div>
            )}
            {/* Constraints + Approach — side by side */}
            <div className="grid gap-3 sm:grid-cols-2">
              {promptFields.constraints && (
                <div className="rounded-lg border border-border bg-muted/30 overflow-hidden">
                  <div className="flex items-center gap-2 px-3.5 py-2.5 border-b border-border/50 text-xs font-semibold text-red-500">
                    &#x1F6AB; Constraints
                  </div>
                  <div className="px-3.5 py-3 text-xs text-muted-foreground leading-relaxed">
                    {promptFields.constraints}
                  </div>
                </div>
              )}
              {promptFields.approach && (
                <div className="rounded-lg border border-border bg-muted/30 overflow-hidden">
                  <div className="flex items-center gap-2 px-3.5 py-2.5 border-b border-border/50 text-xs font-semibold text-blue-500">
                    &#x1F4CB; Approach
                  </div>
                  <div className="px-3.5 py-3 text-xs text-muted-foreground leading-relaxed">
                    {promptFields.approach}
                  </div>
                </div>
              )}
            </div>
          </div>
        </>
      )}

      {/* Raw prompt for non-structured prompts */}
      {(bot.is_published || isOwner) &&
        bot.system_prompt &&
        !promptFields && (
          <div className="space-y-2">
            <h2 className="text-sm font-semibold flex items-center gap-2">
              &#x1F9E0; Personality & Instructions
            </h2>
            <div className="rounded-lg border border-border bg-muted/30 p-4">
              <p className="text-xs text-muted-foreground whitespace-pre-wrap leading-relaxed">
                {bot.system_prompt}
              </p>
            </div>
          </div>
        )}

      {/* Skills & Capabilities */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold flex items-center gap-2">
            <Zap className="h-4 w-4 text-amber-400" /> Skills & Capabilities
            {agentSkills.length > 0 && (
              <span className="rounded-full bg-violet-500/15 px-1.5 py-px text-[10px] font-semibold text-violet-400">
                {agentSkills.length}
              </span>
            )}
          </h2>
          {isOwner && (
            <Button
              variant="ghost"
              size="sm"
              className="h-7 text-xs text-emerald-400 hover:text-emerald-300"
              onClick={() => setAddSkillOpen(true)}
            >
              <Plus className="h-3.5 w-3.5 mr-1" />
              Add Skill
            </Button>
          )}
        </div>

        {agentSkills.length === 0 ? (
          <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed border-border py-6">
            <Package className="h-6 w-6 text-muted-foreground/30" />
            <p className="text-xs text-muted-foreground">
              No skills attached. Add skills to give <span className="font-medium text-foreground">{bot.name}</span> new capabilities.
            </p>
            {isOwner && (
              <Button
                size="sm"
                className="mt-1 h-7 text-xs bg-emerald-500/12 text-emerald-400 border border-emerald-500/25 hover:bg-emerald-500/20"
                onClick={() => setAddSkillOpen(true)}
              >
                <Plus className="h-3 w-3 mr-1" />
                Add Skill
              </Button>
            )}
          </div>
        ) : (
          <div className="flex flex-col gap-1.5">
            {agentSkills.map((skill) => (
              <div
                key={skill.id}
                className="flex items-start gap-3 rounded-lg border border-border bg-muted/30 p-3"
              >
                <Package className="h-4 w-4 text-violet-400 mt-0.5 shrink-0" />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-xs font-medium">{skill.name}</span>
                    {skill.category && (
                      <span className={cn(
                        "rounded-full px-1.5 py-px text-[9px] font-semibold border",
                        skill.category === "Development" && "bg-violet-500/12 text-violet-400 border-violet-500/25",
                        skill.category === "Creative" && "bg-amber-500/12 text-amber-400 border-amber-500/25",
                        skill.category === "Enterprise" && "bg-pink-500/12 text-pink-400 border-pink-500/25",
                        skill.category === "Document" && "bg-cyan-500/12 text-cyan-400 border-cyan-500/25",
                      )}>
                        {skill.category}
                      </span>
                    )}
                  </div>
                  <p className="text-[11px] text-muted-foreground mt-0.5 line-clamp-2 leading-relaxed">
                    {skill.description}
                  </p>
                  <div className="flex items-center gap-2 mt-1">
                    {skill.source_type === "github" && (
                      <span className="inline-flex items-center gap-1 text-[9px] text-muted-foreground/60 border border-border/50 rounded px-1 py-px">
                        <svg viewBox="0 0 16 16" className="h-2 w-2 fill-current"><path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z"/></svg>
                        GitHub
                      </span>
                    )}
                    {skill.source_type === "file" && (
                      <span className="text-[9px] text-muted-foreground/60 border border-border/50 rounded px-1 py-px">
                        File upload
                      </span>
                    )}
                    {skill.source_type === "url" && (
                      <span className="text-[9px] text-muted-foreground/60 border border-border/50 rounded px-1 py-px">
                        URL import
                      </span>
                    )}
                  </div>
                </div>
                {isOwner && (
                  <button
                    className={cn(
                      "text-muted-foreground/40 hover:text-red-400 transition-colors p-0.5",
                      removingSkillId === skill.id && "opacity-50 pointer-events-none"
                    )}
                    title="Remove skill"
                    disabled={removingSkillId === skill.id}
                    onClick={async () => {
                      setRemovingSkillId(skill.id);
                      try {
                        await removeSkillFromAgent(skill.id);
                        toast.success(`Removed "${skill.name}"`);
                        router.refresh();
                      } catch (e) {
                        toast.error(e instanceof Error ? e.message : "Failed to remove skill");
                      } finally {
                        setRemovingSkillId(null);
                      }
                    }}
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Two-column: Activity + Contributing Ideas */}
      <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
        {/* Recent Activity */}
        {recentActivity.length > 0 && (
          <div className="space-y-3">
            <h2 className="text-sm font-semibold flex items-center gap-2">
              &#x1F4C8; Recent Activity
            </h2>
            <div className="flex flex-col gap-1.5">
              {recentActivity.map((activity) => {
                const { icon: Icon, className: iconClass } = getActivityIcon(activity.action);
                const actionLabel = activity.action === "moved"
                  ? `Moved "${activity.taskTitle}" ${activity.details?.to ? `to ${activity.details.to}` : ""}`
                  : activity.action === "comment_added"
                    ? `Commented on "${activity.taskTitle}"`
                    : `${activity.action.replace(/_/g, " ")} "${activity.taskTitle}"`;

                return (
                  <div
                    key={activity.id}
                    className="flex items-start gap-2.5 rounded-md border border-border/50 bg-muted/30 p-2.5"
                  >
                    <div className={cn("flex h-7 w-7 shrink-0 items-center justify-center rounded-md", iconClass)}>
                      <Icon className="h-3.5 w-3.5" />
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">{actionLabel}</p>
                      <p className="text-[10px] text-muted-foreground/60 mt-0.5">
                        {formatRelativeTime(activity.created_at)}
                      </p>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Contributing To */}
        {contributingIdeas.length > 0 && (
          <div className="space-y-3">
            <h2 className="text-sm font-semibold flex items-center gap-2">
              <Lightbulb className="h-4 w-4" />
              Contributing To
            </h2>
            <div className="flex flex-col gap-1.5">
              {contributingIdeas.map((idea) => (
                <Link
                  key={idea.id}
                  href={`/ideas/${idea.id}`}
                  className="flex items-center gap-2 rounded-md border border-border/50 bg-muted/30 p-2.5 transition-colors hover:bg-muted/50"
                >
                  <Lightbulb className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                  <span className="text-sm font-medium flex-1 truncate">{idea.title}</span>
                  {idea.assignedCount > 0 ? (
                    <Badge
                      variant="secondary"
                      className="text-[10px] bg-emerald-500/15 text-emerald-500 border-0 shrink-0"
                    >
                      {idea.assignedCount} assigned
                    </Badge>
                  ) : (
                    <span className="text-[10px] text-muted-foreground shrink-0">Available</span>
                  )}
                </Link>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Active Tasks */}
      {tasks.length > 0 && (
        <div className="space-y-3">
          <h2 className="text-sm font-semibold">Active Tasks</h2>
          <div className="flex flex-col gap-1.5">
            {tasks.map((task) => (
              <div
                key={task.id}
                className="flex items-center justify-between rounded-md border border-border/50 bg-muted/30 p-2.5"
              >
                <span className="text-sm truncate">{task.title}</span>
                <Badge variant="outline" className="text-[10px] shrink-0">
                  {task.board_columns.title}
                </Badge>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Edit dialog */}
      {isOwner && (
        <EditAgentDialog
          bot={bot}
          open={editOpen}
          onOpenChange={setEditOpen}
        />
      )}

      {/* Export as Skill dialog */}
      {isOwner && (
        <ExportSkillDialog
          open={exportOpen}
          onOpenChange={setExportOpen}
          botId={bot.id}
          botName={bot.name}
        />
      )}

      {/* Add Skill dialog */}
      {isOwner && (
        <AddSkillDialog
          open={addSkillOpen}
          onOpenChange={setAddSkillOpen}
          botId={bot.id}
          botName={bot.name}
          existingSkillNames={agentSkills.map((s) => s.name)}
        />
      )}
    </div>
  );
}
