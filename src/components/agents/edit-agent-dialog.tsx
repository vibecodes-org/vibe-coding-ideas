"use client";

import { useState, useRef } from "react";
import { toast } from "sonner";
import { Pencil, Trash2, Upload } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { updateBot, deleteBot } from "@/actions/bots";
import { PromptBuilder } from "@/components/profile/prompt-builder";
import { createClient } from "@/lib/supabase/client";
import { getInitials } from "@/lib/utils";
import type { BotProfile } from "@/types";

interface EditAgentDialogProps {
  bot: BotProfile;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function EditAgentDialog({ bot, open, onOpenChange }: EditAgentDialogProps) {
  const [name, setName] = useState(bot.name);
  const [role, setRole] = useState(bot.role ?? "");
  const [systemPrompt, setSystemPrompt] = useState(bot.system_prompt ?? "");
  const [bio, setBio] = useState(bot.bio ?? "");
  const [skillsInput, setSkillsInput] = useState((bot.skills ?? []).join(", "));
  const [isPublished, setIsPublished] = useState(bot.is_published);
  const [submitting, setSubmitting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const confirmTimer = useRef<ReturnType<typeof setTimeout>>(null);

  // Avatar upload
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const isDefaultBot = bot.id === "a0000000-0000-4000-a000-000000000001";

  function handleFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      toast.error("Please select an image file");
      return;
    }
    if (file.size > 2 * 1024 * 1024) {
      toast.error("Image must be 2MB or less");
      return;
    }
    setSelectedFile(file);
    setPreviewUrl(URL.createObjectURL(file));
  }

  function parseSkills(): string[] {
    if (!skillsInput.trim()) return [];
    return skillsInput
      .split(",")
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean)
      .slice(0, 10);
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;

    setSubmitting(true);
    try {
      let avatarUrl: string | undefined = undefined;

      // Upload avatar if selected
      if (selectedFile) {
        const supabase = createClient();
        const filePath = `${bot.id}/avatar`;
        const { error: uploadError } = await supabase.storage
          .from("avatars")
          .upload(filePath, selectedFile, { upsert: true, cacheControl: "3600" });

        if (!uploadError) {
          const { data: { publicUrl } } = supabase.storage
            .from("avatars")
            .getPublicUrl(filePath);
          avatarUrl = `${publicUrl}?t=${Date.now()}`;
        }
      }

      await updateBot(bot.id, {
        name: name.trim(),
        role: role.trim() || null,
        system_prompt: systemPrompt.trim() || null,
        bio: bio.trim() || null,
        skills: parseSkills(),
        is_published: isPublished,
        ...(avatarUrl !== undefined && { avatar_url: avatarUrl }),
      });
      toast.success("Agent updated");
      onOpenChange(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to update agent");
    } finally {
      setSubmitting(false);
    }
  }

  function handleDeleteClick() {
    if (!confirmDelete) {
      setConfirmDelete(true);
      confirmTimer.current = setTimeout(() => setConfirmDelete(false), 3000);
      return;
    }
    if (confirmTimer.current) clearTimeout(confirmTimer.current);
    setDeleting(true);
    deleteBot(bot.id)
      .then(() => {
        toast.success("Agent deleted");
        onOpenChange(false);
      })
      .catch((err) => {
        toast.error(err instanceof Error ? err.message : "Failed to delete agent");
        setDeleting(false);
        setConfirmDelete(false);
      });
  }

  const displayAvatar = previewUrl ?? bot.avatar_url ?? undefined;
  const initials = getInitials(name);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Pencil className="h-4 w-4" />
            Edit Agent
          </DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSave} className="space-y-4">
          {/* Avatar + Name + Tagline row */}
          <div className="flex gap-4">
            <div
              className="group relative cursor-pointer shrink-0"
              onClick={() => fileInputRef.current?.click()}
            >
              <Avatar className="h-14 w-14">
                <AvatarImage src={displayAvatar} />
                <AvatarFallback className="bg-primary/10 text-lg">
                  {initials}
                </AvatarFallback>
              </Avatar>
              <div className="absolute inset-0 flex items-center justify-center rounded-full bg-black/50 opacity-0 transition-opacity group-hover:opacity-100">
                <Upload className="h-4 w-4 text-white" />
              </div>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={handleFileSelect}
              />
            </div>
            <div className="flex-1 space-y-2">
              <div>
                <Label htmlFor="edit-bot-name" className="text-xs">Name</Label>
                <Input
                  id="edit-bot-name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  maxLength={100}
                  required
                  className="mt-1"
                />
              </div>
              <div>
                <Label htmlFor="edit-bot-bio" className="text-xs">
                  Tagline <span className="font-normal text-muted-foreground">(optional)</span>
                </Label>
                <Input
                  id="edit-bot-bio"
                  value={bio}
                  onChange={(e) => setBio(e.target.value)}
                  placeholder='e.g. "I break things so users don&apos;t have to"'
                  maxLength={500}
                  className="mt-1"
                />
              </div>
            </div>
          </div>

          {/* Role */}
          <div className="space-y-1">
            <Label htmlFor="edit-bot-role" className="text-xs">Role</Label>
            <Input
              id="edit-bot-role"
              value={role}
              onChange={(e) => setRole(e.target.value)}
              placeholder="e.g. Developer"
              maxLength={50}
            />
          </div>

          {/* Skills (comma-separated) */}
          <div className="space-y-1">
            <Label htmlFor="edit-bot-skills" className="text-xs">
              Skills <span className="font-normal text-muted-foreground">(optional)</span>
            </Label>
            <Input
              id="edit-bot-skills"
              value={skillsInput}
              onChange={(e) => setSkillsInput(e.target.value)}
              placeholder="Comma-separated skills"
              maxLength={300}
            />
            <p className="text-[10px] text-muted-foreground">
              Shown on the agent card and profile.
            </p>
          </div>

          {/* Prompt Builder */}
          <PromptBuilder
            role={role}
            value={systemPrompt}
            onChange={setSystemPrompt}
          />

          {/* Publishing toggles */}
          <div className="space-y-3 rounded-lg border border-border p-3">
            <p className="text-xs font-medium">Community</p>
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm">Publish to Community</p>
                <p className="text-[10px] text-muted-foreground">
                  Make this agent discoverable by others
                </p>
              </div>
              <Switch
                checked={isPublished}
                onCheckedChange={setIsPublished}
              />
            </div>
          </div>

          {/* Actions */}
          <div className="flex justify-between pt-2 border-t border-border">
            {!isDefaultBot ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className={`gap-1.5 ${confirmDelete ? "text-destructive font-medium" : "text-muted-foreground"}`}
                onClick={handleDeleteClick}
                disabled={deleting}
              >
                <Trash2 className="h-3.5 w-3.5" />
                {deleting
                  ? "Deleting..."
                  : confirmDelete
                    ? "Are you sure?"
                    : "Delete"}
              </Button>
            ) : (
              <div />
            )}
            <div className="flex gap-2">
              <Button
                type="button"
                variant="ghost"
                onClick={() => onOpenChange(false)}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={submitting || !name.trim()}>
                {submitting ? "Saving..." : "Save"}
              </Button>
            </div>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
