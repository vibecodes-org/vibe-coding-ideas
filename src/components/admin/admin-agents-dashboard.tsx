"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Plus, MoreHorizontal, Pencil, Trash2, Bot, Link as LinkIcon } from "lucide-react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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
import { deleteAdminAgent } from "@/actions/admin-agents";
import { getRoleColor } from "@/lib/agent-colors";
import { cn, getInitials } from "@/lib/utils";
import { CreateAdminAgentDialog } from "./create-admin-agent-dialog";
import type { BotProfile } from "@/types";

interface AdminAgentsDashboardProps {
  agents: BotProfile[];
  onRefresh: () => void;
}

export function AdminAgentsDashboard({ agents, onRefresh }: AdminAgentsDashboardProps) {
  const router = useRouter();
  const [deleteTarget, setDeleteTarget] = useState<BotProfile | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [editAgent, setEditAgent] = useState<BotProfile | null>(null);

  async function handleDelete() {
    if (!deleteTarget) return;
    try {
      await deleteAdminAgent(deleteTarget.id);
      setDeleteTarget(null);
      toast.success(`Agent "${deleteTarget.name}" deleted`);
      onRefresh();
      router.refresh();
    } catch {
      toast.error("Failed to delete agent");
    }
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold">VibeCodes Agents</h2>
          <p className="text-sm text-muted-foreground">
            {agents.length} agent{agents.length !== 1 ? "s" : ""} managed by VibeCodes
          </p>
        </div>
        <Button size="sm" onClick={() => setCreateOpen(true)}>
          <Plus className="mr-2 h-4 w-4" />
          Create VibeCodes Agent
        </Button>
      </div>

      {/* Table */}
      <div className="max-h-[500px] overflow-y-auto rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-[50px]">Avatar</TableHead>
              <TableHead className="w-[160px]">Name</TableHead>
              <TableHead className="w-[120px]">Role</TableHead>
              <TableHead>Bio</TableHead>
              <TableHead className="w-[200px]">Skills</TableHead>
              <TableHead className="w-[80px] text-center">Upvotes</TableHead>
              <TableHead className="w-[80px] text-center">Cloned</TableHead>
              <TableHead className="w-[50px]" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {agents.map((agent) => {
              const agentColors = getRoleColor(agent.role);
              return (
              <TableRow key={agent.id}>
                <TableCell className="p-2">
                  <Avatar className="h-8 w-8">
                    <AvatarImage src={agent.avatar_url ?? undefined} />
                    <AvatarFallback className={cn("text-xs", agentColors.avatarBg, agentColors.avatarText)}>
                      {getInitials(agent.name)}
                    </AvatarFallback>
                  </Avatar>
                </TableCell>
                <TableCell className="p-2">
                  <div className="flex items-center gap-1.5">
                    <Link
                      href={`/agents/${agent.id}`}
                      className="text-sm font-medium hover:underline truncate max-w-[140px]"
                    >
                      {agent.name}
                    </Link>
                    <Link
                      href={`/agents/${agent.id}`}
                      className="text-muted-foreground hover:text-foreground shrink-0"
                    >
                      <LinkIcon className="h-3 w-3" />
                    </Link>
                  </div>
                  {!agent.is_active && (
                    <Badge variant="outline" className="mt-0.5 text-[10px] text-muted-foreground">
                      Inactive
                    </Badge>
                  )}
                </TableCell>
                <TableCell className="p-2">
                  {agent.role ? (
                    <Badge className={cn("text-[10px] max-w-[110px] truncate border-0", agentColors.badge)}>
                      {agent.role}
                    </Badge>
                  ) : (
                    <span className="text-xs text-muted-foreground">--</span>
                  )}
                </TableCell>
                <TableCell className="p-2">
                  <p className="text-xs text-muted-foreground line-clamp-2">
                    {agent.bio || "--"}
                  </p>
                </TableCell>
                <TableCell className="p-2">
                  {agent.skills && agent.skills.length > 0 ? (
                    <div className="flex flex-wrap gap-1">
                      {agent.skills.slice(0, 3).map((skill) => (
                        <Badge
                          key={skill}
                          variant="outline"
                          className="text-[10px] font-normal"
                        >
                          {skill}
                        </Badge>
                      ))}
                      {agent.skills.length > 3 && (
                        <span className="text-[10px] text-muted-foreground self-center">
                          +{agent.skills.length - 3}
                        </span>
                      )}
                    </div>
                  ) : (
                    <span className="text-xs text-muted-foreground">--</span>
                  )}
                </TableCell>
                <TableCell className="p-2 text-center">
                  <span className="text-sm font-medium">{agent.community_upvotes}</span>
                </TableCell>
                <TableCell className="p-2 text-center">
                  <span className="text-sm font-medium">{agent.times_cloned}</span>
                </TableCell>
                <TableCell className="p-2">
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="icon" className="h-7 w-7">
                        <MoreHorizontal className="h-4 w-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem onClick={() => setEditAgent(agent)}>
                        <Pencil className="mr-2 h-4 w-4" />
                        Edit
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        onClick={() => setDeleteTarget(agent)}
                        className="text-destructive"
                      >
                        <Trash2 className="mr-2 h-4 w-4" />
                        Delete
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </TableCell>
              </TableRow>
              );
            })}
            {agents.length === 0 && (
              <TableRow>
                <TableCell colSpan={8} className="p-8 text-center">
                  <div className="flex flex-col items-center gap-2 text-muted-foreground">
                    <Bot className="h-8 w-8" />
                    <p className="text-sm">No VibeCodes agents yet.</p>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setCreateOpen(true)}
                    >
                      <Plus className="mr-2 h-4 w-4" />
                      Create your first agent
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      {/* Create / Edit Dialog */}
      <CreateAdminAgentDialog
        open={createOpen || !!editAgent}
        onOpenChange={(open) => {
          if (!open) {
            setCreateOpen(false);
            setEditAgent(null);
          }
        }}
        editAgent={editAgent}
        onSuccess={() => {
          setCreateOpen(false);
          setEditAgent(null);
          onRefresh();
          router.refresh();
        }}
      />

      {/* Delete confirmation */}
      <AlertDialog open={!!deleteTarget} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete agent?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete <strong>{deleteTarget?.name}</strong> and its
              associated user account. This action cannot be undone.
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
