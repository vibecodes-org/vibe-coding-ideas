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
  Zap,
  Plus,
  X,
} from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { AgentVoteButton } from "./agent-vote-button";
import { CloneAgentButton } from "./clone-agent-button";
import { EditAgentDialog } from "./edit-agent-dialog";
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
            <Button
              variant="outline"
              size="sm"
              className="text-xs"
              onClick={() => setEditOpen(true)}
            >
              Edit Profile
            </Button>
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

      {/* Skills & Capabilities */}
      <div className="space-y-2">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-sm font-semibold flex items-center gap-2">
            <Zap className="h-4 w-4 text-amber-400" /> Skills & Capabilities
            {agentSkills.length > 0 && (
              <span className="rounded-full bg-violet-500/15 px-1.5 py-px text-[10px] font-semibold text-violet-400">
                {agentSkills.length}
              </span>
            )}
          </h2>
          {isOwner && agentSkills.length > 0 && (
            <Button
              size="sm"
              className="h-8 text-xs bg-emerald-600 text-white hover:bg-emerald-500"
              onClick={() => setAddSkillOpen(true)}
            >
              <Plus className="h-3.5 w-3.5 mr-1" />
              Add Skill
            </Button>
          )}
        </div>

        {agentSkills.length === 0 ? (
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border border-emerald-500/25 bg-emerald-500/10 px-3 py-2.5">
            <span aria-hidden="true" className="text-amber-400">
              &#x26A1;
            </span>
            <p className="flex-1 min-w-[12rem] text-xs text-muted-foreground">
              Skills are reusable capabilities your agent can use on tasks.
            </p>
            {isOwner && (
              <div className="flex flex-wrap items-center gap-3">
                <Button
                  size="sm"
                  className="min-h-[44px] sm:min-h-0 sm:h-8 text-xs bg-emerald-600 text-white hover:bg-emerald-500"
                  onClick={() => setAddSkillOpen(true)}
                >
                  <Plus className="h-3.5 w-3.5 mr-1" />
                  Add Skill
                </Button>
                <button
                  type="button"
                  className="text-xs font-medium text-emerald-400 underline-offset-2 hover:text-emerald-300 hover:underline"
                  onClick={() => setAddSkillOpen(true)}
                >
                  Browse the skills directory &rarr;
                </button>
              </div>
            )}
          </div>
        ) : (
          <div className="flex flex-wrap gap-1.5">
            {agentSkills.map((skill) => {
              const sourceLabel =
                skill.source_type === "github"
                  ? "GitHub"
                  : skill.source_type === "file"
                    ? "File upload"
                    : skill.source_type === "url"
                      ? "URL import"
                      : skill.source_type;
              return (
                <span
                  key={skill.id}
                  title={`${skill.name} · ${skill.category ?? "Uncategorized"} · ${skill.description} (${sourceLabel})`}
                  className="inline-flex max-w-[12rem] items-center gap-1.5 rounded-full border border-border bg-muted/40 py-1 pl-2.5 pr-1"
                >
                  <span
                    className={cn(
                      "h-1.5 w-1.5 shrink-0 rounded-full",
                      skill.category === "Development" && "bg-violet-400",
                      skill.category === "Creative" && "bg-amber-400",
                      skill.category === "Enterprise" && "bg-pink-400",
                      skill.category === "Document" && "bg-cyan-400",
                      !["Development", "Creative", "Enterprise", "Document"].includes(
                        skill.category ?? ""
                      ) && "bg-muted-foreground"
                    )}
                  />
                  <span className="min-w-0 truncate font-mono text-[11px] font-medium">
                    {skill.name}
                  </span>
                  {isOwner && (
                    <button
                      type="button"
                      aria-label={`Remove skill ${skill.name}`}
                      className={cn(
                        "flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-muted-foreground/50 transition-colors hover:bg-red-500/10 hover:text-red-400",
                        removingSkillId === skill.id && "opacity-50 pointer-events-none"
                      )}
                      disabled={removingSkillId === skill.id}
                      onClick={async () => {
                        setRemovingSkillId(skill.id);
                        try {
                          await removeSkillFromAgent(skill.id);
                          toast.success(`Removed "${skill.name}"`);
                          router.refresh();
                        } catch (e) {
                          toast.error(
                            e instanceof Error ? e.message : "Failed to remove skill"
                          );
                        } finally {
                          setRemovingSkillId(null);
                        }
                      }}
                    >
                      <X className="h-3 w-3" />
                    </button>
                  )}
                </span>
              );
            })}
          </div>
        )}
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
