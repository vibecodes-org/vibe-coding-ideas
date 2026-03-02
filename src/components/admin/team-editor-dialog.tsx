"use client";

import { useState, useEffect, useMemo } from "react";
import { toast } from "sonner";
import { Plus, X, Search, GripVertical } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  createFeaturedTeam,
  updateFeaturedTeam,
  setTeamAgents,
} from "@/actions/admin-agents";
import { getInitials } from "@/lib/utils";
import type { FeaturedTeamWithAgents, BotProfile } from "@/types";

interface SelectedAgent {
  botId: string;
  name: string;
  role: string | null;
  avatarUrl: string | null;
  displayDescription: string;
}

interface TeamEditorDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  editTeam?: FeaturedTeamWithAgents | null;
  adminAgents: BotProfile[];
  communityAgents: BotProfile[];
}

export function TeamEditorDialog({
  open,
  onOpenChange,
  editTeam,
  adminAgents,
  communityAgents,
}: TeamEditorDialogProps) {
  const isEditing = !!editTeam;

  const [name, setName] = useState("");
  const [icon, setIcon] = useState("\u{1F680}");
  const [description, setDescription] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedAgents, setSelectedAgents] = useState<SelectedAgent[]>([]);
  const [submitting, setSubmitting] = useState(false);

  // Populate form when editing or when dialog opens
  useEffect(() => {
    if (open && editTeam) {
      setName(editTeam.name);
      setIcon(editTeam.icon || "\u{1F680}");
      setDescription(editTeam.description || "");
      setSelectedAgents(
        editTeam.agents
          .sort((a, b) => a.display_order - b.display_order)
          .map((ta) => ({
            botId: ta.bot_id,
            name: ta.bot.name,
            role: ta.bot.role,
            avatarUrl: ta.bot.avatar_url,
            displayDescription: ta.display_description || "",
          }))
      );
    } else if (open && !editTeam) {
      setName("");
      setIcon("\u{1F680}");
      setDescription("");
      setSelectedAgents([]);
    }
    setSearchQuery("");
  }, [open, editTeam]);

  const selectedBotIds = useMemo(
    () => new Set(selectedAgents.map((a) => a.botId)),
    [selectedAgents]
  );

  const filteredAdminAgents = useMemo(() => {
    const q = searchQuery.toLowerCase();
    return adminAgents.filter(
      (a) =>
        !selectedBotIds.has(a.id) &&
        (a.name.toLowerCase().includes(q) ||
          (a.role && a.role.toLowerCase().includes(q)))
    );
  }, [adminAgents, selectedBotIds, searchQuery]);

  const filteredCommunityAgents = useMemo(() => {
    const q = searchQuery.toLowerCase();
    return communityAgents.filter(
      (a) =>
        !selectedBotIds.has(a.id) &&
        (a.name.toLowerCase().includes(q) ||
          (a.role && a.role.toLowerCase().includes(q)))
    );
  }, [communityAgents, selectedBotIds, searchQuery]);

  function handleAddAgent(agent: BotProfile) {
    setSelectedAgents((prev) => [
      ...prev,
      {
        botId: agent.id,
        name: agent.name,
        role: agent.role,
        avatarUrl: agent.avatar_url,
        displayDescription: "",
      },
    ]);
  }

  function handleRemoveAgent(botId: string) {
    setSelectedAgents((prev) => prev.filter((a) => a.botId !== botId));
  }

  function handleDescriptionChange(botId: string, value: string) {
    setSelectedAgents((prev) =>
      prev.map((a) =>
        a.botId === botId ? { ...a, displayDescription: value } : a
      )
    );
  }

  function handleMoveUp(index: number) {
    if (index === 0) return;
    setSelectedAgents((prev) => {
      const next = [...prev];
      [next[index - 1], next[index]] = [next[index], next[index - 1]];
      return next;
    });
  }

  function handleMoveDown(index: number) {
    setSelectedAgents((prev) => {
      if (index >= prev.length - 1) return prev;
      const next = [...prev];
      [next[index], next[index + 1]] = [next[index + 1], next[index]];
      return next;
    });
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;

    setSubmitting(true);
    try {
      const agentPayload = selectedAgents.map((a, i) => ({
        botId: a.botId,
        displayDescription: a.displayDescription.trim() || null,
        displayOrder: i,
      }));

      if (isEditing && editTeam) {
        await updateFeaturedTeam(editTeam.id, {
          name: name.trim(),
          icon: icon.trim() || "\u{1F680}",
          description: description.trim() || null,
        });
        await setTeamAgents(editTeam.id, agentPayload);
        toast.success("Featured team updated");
      } else {
        await createFeaturedTeam(
          name.trim(),
          icon.trim() || "\u{1F680}",
          description.trim() || null,
          agentPayload
        );
        toast.success("Featured team created");
      }
      onOpenChange(false);
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Failed to save team"
      );
    } finally {
      setSubmitting(false);
    }
  }

  const hasAvailableAgents =
    filteredAdminAgents.length > 0 || filteredCommunityAgents.length > 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {isEditing ? "Edit Featured Team" : "Create Featured Team"}
          </DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-5">
          {/* Team details */}
          <div className="grid grid-cols-[4rem_1fr] gap-3">
            <div className="space-y-1">
              <Label htmlFor="team-icon" className="text-xs">
                Icon
              </Label>
              <Input
                id="team-icon"
                value={icon}
                onChange={(e) => setIcon(e.target.value)}
                placeholder="\u{1F680}"
                maxLength={4}
                className="text-center text-lg"
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="team-name" className="text-xs">
                Name
              </Label>
              <Input
                id="team-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Full Stack Starter"
                maxLength={200}
                required
              />
            </div>
          </div>
          <div className="space-y-1">
            <Label htmlFor="team-description" className="text-xs">
              Description{" "}
              <span className="font-normal text-muted-foreground">
                (optional)
              </span>
            </Label>
            <Textarea
              id="team-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="A short description of what this team is best at..."
              rows={2}
              maxLength={500}
            />
          </div>

          {/* Agent picker */}
          <div className="space-y-2">
            <Label className="text-xs">Add Agents</Label>
            <div className="relative">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search agents by name or role..."
                className="pl-9"
              />
            </div>
            <ScrollArea className="h-48 rounded-md border border-border">
              <div className="p-2 space-y-3">
                {filteredAdminAgents.length > 0 && (
                  <div>
                    <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground px-1 mb-1">
                      VibeCodes Agents
                    </p>
                    <div className="space-y-0.5">
                      {filteredAdminAgents.map((agent) => (
                        <div
                          key={agent.id}
                          className="flex items-center gap-2 rounded-md px-2 py-1.5 hover:bg-muted/50 transition-colors"
                        >
                          <Avatar className="h-7 w-7 shrink-0">
                            <AvatarImage src={agent.avatar_url ?? undefined} />
                            <AvatarFallback className="text-[10px] bg-primary/10">
                              {getInitials(agent.name)}
                            </AvatarFallback>
                          </Avatar>
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium truncate">
                              {agent.name}
                            </p>
                            {agent.role && (
                              <p className="text-[11px] text-muted-foreground truncate">
                                {agent.role}
                              </p>
                            )}
                          </div>
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            className="h-7 px-2 text-xs shrink-0"
                            onClick={() => handleAddAgent(agent)}
                          >
                            <Plus className="h-3.5 w-3.5 mr-1" />
                            Add
                          </Button>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                {filteredCommunityAgents.length > 0 && (
                  <div>
                    <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground px-1 mb-1">
                      Community Agents
                    </p>
                    <div className="space-y-0.5">
                      {filteredCommunityAgents.map((agent) => (
                        <div
                          key={agent.id}
                          className="flex items-center gap-2 rounded-md px-2 py-1.5 hover:bg-muted/50 transition-colors"
                        >
                          <Avatar className="h-7 w-7 shrink-0">
                            <AvatarImage src={agent.avatar_url ?? undefined} />
                            <AvatarFallback className="text-[10px] bg-primary/10">
                              {getInitials(agent.name)}
                            </AvatarFallback>
                          </Avatar>
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium truncate">
                              {agent.name}
                            </p>
                            {agent.role && (
                              <p className="text-[11px] text-muted-foreground truncate">
                                {agent.role}
                              </p>
                            )}
                          </div>
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            className="h-7 px-2 text-xs shrink-0"
                            onClick={() => handleAddAgent(agent)}
                          >
                            <Plus className="h-3.5 w-3.5 mr-1" />
                            Add
                          </Button>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                {!hasAvailableAgents && (
                  <p className="text-sm text-muted-foreground text-center py-6">
                    {searchQuery
                      ? "No matching agents found"
                      : "All agents have been added"}
                  </p>
                )}
              </div>
            </ScrollArea>
          </div>

          {/* Selected agents */}
          <div className="space-y-2">
            <Label className="text-xs">
              Selected Agents{" "}
              <span className="font-normal text-muted-foreground">
                ({selectedAgents.length})
              </span>
            </Label>
            {selectedAgents.length === 0 ? (
              <p className="text-sm text-muted-foreground border border-dashed border-border rounded-md py-6 text-center">
                No agents selected yet. Add agents from the list above.
              </p>
            ) : (
              <div className="space-y-1.5">
                {selectedAgents.map((agent, index) => (
                  <div
                    key={agent.botId}
                    className="flex items-start gap-2 rounded-md border border-border p-2 bg-muted/30"
                  >
                    <div className="flex flex-col gap-0.5 pt-1.5 shrink-0">
                      <button
                        type="button"
                        className="text-muted-foreground hover:text-foreground disabled:opacity-30 transition-colors"
                        disabled={index === 0}
                        onClick={() => handleMoveUp(index)}
                        aria-label="Move up"
                      >
                        <GripVertical className="h-3.5 w-3.5" />
                      </button>
                    </div>
                    <Avatar className="h-8 w-8 shrink-0 mt-0.5">
                      <AvatarImage src={agent.avatarUrl ?? undefined} />
                      <AvatarFallback className="text-[10px] bg-primary/10">
                        {getInitials(agent.name)}
                      </AvatarFallback>
                    </Avatar>
                    <div className="flex-1 min-w-0 space-y-1">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium truncate">
                          {agent.name}
                        </span>
                        {agent.role && (
                          <span className="text-[11px] text-muted-foreground shrink-0">
                            {agent.role}
                          </span>
                        )}
                      </div>
                      <Input
                        value={agent.displayDescription}
                        onChange={(e) =>
                          handleDescriptionChange(agent.botId, e.target.value)
                        }
                        placeholder="Display description (optional)"
                        className="h-7 text-xs"
                        maxLength={200}
                      />
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="h-7 w-7 p-0 text-muted-foreground hover:text-foreground"
                        disabled={index === 0}
                        onClick={() => handleMoveUp(index)}
                        aria-label={`Move ${agent.name} up`}
                      >
                        <span className="text-xs">&uarr;</span>
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="h-7 w-7 p-0 text-muted-foreground hover:text-foreground"
                        disabled={index === selectedAgents.length - 1}
                        onClick={() => handleMoveDown(index)}
                        aria-label={`Move ${agent.name} down`}
                      >
                        <span className="text-xs">&darr;</span>
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="h-7 w-7 p-0 text-destructive hover:text-destructive"
                        onClick={() => handleRemoveAgent(agent.botId)}
                        aria-label={`Remove ${agent.name}`}
                      >
                        <X className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Actions */}
          <div className="flex justify-end gap-2 pt-2 border-t border-border">
            <Button
              type="button"
              variant="ghost"
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={submitting || !name.trim()}>
              {submitting
                ? isEditing
                  ? "Saving..."
                  : "Creating..."
                : isEditing
                  ? "Save Changes"
                  : "Create Team"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
