"use client";

import { useState, useRef } from "react";
import { toast } from "sonner";
import { Bot, Upload } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { BOT_ROLE_TEMPLATES } from "@/lib/constants";
import { createBot } from "@/actions/bots";
import { PromptBuilder } from "@/components/profile/prompt-builder";
import { createClient } from "@/lib/supabase/client";
import { cn, getInitials } from "@/lib/utils";
import type { StructuredPromptFields } from "@/lib/prompt-builder";

const TEMPLATE_CHIPS: { role: string; icon: string }[] = [
  { role: "Developer", icon: "\u{1F4BB}" },
  { role: "UX Designer", icon: "\u{1F3A8}" },
  { role: "QA Tester", icon: "\u{1F50D}" },
  { role: "Product Owner", icon: "\u{1F4CB}" },
  { role: "Business Analyst", icon: "\u{1F4CA}" },
  { role: "DevOps", icon: "\u{2699}" },
];

interface CreateAgentDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function CreateAgentDialog({ open, onOpenChange }: CreateAgentDialogProps) {
  const [name, setName] = useState("");
  const [role, setRole] = useState("");
  const [systemPrompt, setSystemPrompt] = useState("");
  const [bio, setBio] = useState("");
  const [skillsInput, setSkillsInput] = useState("");
  const [selectedTemplate, setSelectedTemplate] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [templateStructured, setTemplateStructured] =
    useState<StructuredPromptFields | null>(null);
  const [promptKey, setPromptKey] = useState(0);

  // Avatar upload
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  function handleTemplateSelect(templateRole: string) {
    const template = BOT_ROLE_TEMPLATES.find((t) => t.role === templateRole);
    if (template) {
      setSelectedTemplate(templateRole);
      setRole(template.role);
      setSystemPrompt(template.prompt);
      setTemplateStructured(
        template.structured ? { ...template.structured } : null
      );
      setPromptKey((k) => k + 1);
    }
  }

  function handleReset() {
    setName("");
    setRole("");
    setSystemPrompt("");
    setBio("");
    setSkillsInput("");
    setSelectedTemplate(null);
    setTemplateStructured(null);
    setPromptKey((k) => k + 1);
    setSelectedFile(null);
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setPreviewUrl(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  function handleOpenChange(isOpen: boolean) {
    onOpenChange(isOpen);
    if (!isOpen) handleReset();
  }

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

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;

    setSubmitting(true);
    try {
      const skills = parseSkills();

      // Create bot first to get ID, then upload avatar
      const botId = await createBot(
        name.trim(),
        role.trim() || null,
        systemPrompt.trim() || null,
        null,
        bio.trim() || null,
        skills
      );

      // Upload avatar if selected
      if (selectedFile && botId) {
        const supabase = createClient();
        const filePath = `${botId}/avatar`;
        const { error: uploadError } = await supabase.storage
          .from("avatars")
          .upload(filePath, selectedFile, { upsert: true, cacheControl: "3600" });

        if (!uploadError) {
          const { data: { publicUrl } } = supabase.storage
            .from("avatars")
            .getPublicUrl(filePath);
          const avatarUrl = `${publicUrl}?t=${Date.now()}`;

          // Update bot with avatar URL
          const { updateBot } = await import("@/actions/bots");
          await updateBot(botId, { avatar_url: avatarUrl });
        }
      }

      toast.success("Agent created");
      handleOpenChange(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to create agent");
    } finally {
      setSubmitting(false);
    }
  }

  const initials = getInitials(name || null);

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-lg max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Bot className="h-5 w-5" />
            Create Agent
          </DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Avatar + Name + Tagline row */}
          <div className="flex gap-4">
            <div
              className="group relative cursor-pointer shrink-0"
              onClick={() => fileInputRef.current?.click()}
            >
              <Avatar className="h-14 w-14">
                <AvatarImage src={previewUrl ?? undefined} />
                <AvatarFallback className="bg-primary/10 text-lg border-2 border-dashed border-border">
                  {previewUrl ? initials : "\u{1F4F7}"}
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
                <Label htmlFor="bot-name" className="text-xs">Name</Label>
                <Input
                  id="bot-name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder='e.g. Dev Alpha, Sarah the Reviewer'
                  maxLength={100}
                  required
                  className="mt-1"
                />
              </div>
              <div>
                <Label htmlFor="bot-bio" className="text-xs">
                  Tagline <span className="font-normal text-muted-foreground">(optional)</span>
                </Label>
                <Input
                  id="bot-bio"
                  value={bio}
                  onChange={(e) => setBio(e.target.value)}
                  placeholder='e.g. "I break things so users don&apos;t have to"'
                  maxLength={500}
                  className="mt-1"
                />
              </div>
            </div>
          </div>

          {/* Template picker chips */}
          <div className="space-y-2">
            <Label className="text-xs">Start from a template</Label>
            <div className="grid grid-cols-3 gap-1.5">
              {TEMPLATE_CHIPS.map((t) => (
                <button
                  key={t.role}
                  type="button"
                  onClick={() => handleTemplateSelect(t.role)}
                  className={cn(
                    "flex flex-col items-center gap-0.5 rounded-md border py-2 px-2 text-xs font-medium transition-colors",
                    selectedTemplate === t.role
                      ? "border-violet-500 bg-violet-500/15 text-violet-400"
                      : "border-border text-muted-foreground hover:border-violet-500/30 hover:text-foreground"
                  )}
                >
                  <span className="text-base">{t.icon}</span>
                  {t.role}
                </button>
              ))}
            </div>
          </div>

          {/* Role */}
          <div className="space-y-1">
            <Label htmlFor="bot-role" className="text-xs">Role</Label>
            <Input
              id="bot-role"
              value={role}
              onChange={(e) => setRole(e.target.value)}
              placeholder="e.g. Developer, QA Tester"
              maxLength={50}
            />
            <p className="text-[10px] text-muted-foreground">
              Short role label shown as a badge next to the agent&apos;s name.
            </p>
          </div>

          {/* Skills (comma-separated) */}
          <div className="space-y-1">
            <Label htmlFor="bot-skills" className="text-xs">
              Skills <span className="font-normal text-muted-foreground">(optional)</span>
            </Label>
            <Input
              id="bot-skills"
              value={skillsInput}
              onChange={(e) => setSkillsInput(e.target.value)}
              placeholder="Comma-separated skills"
              maxLength={300}
            />
            <p className="text-[10px] text-muted-foreground">
              Shown on the agent card and profile. Helps the community find your agent.
            </p>
          </div>

          {/* Prompt Builder */}
          <PromptBuilder
            key={promptKey}
            role={role}
            value={systemPrompt}
            onChange={setSystemPrompt}
            templateStructured={templateStructured}
          />

          {/* Actions */}
          <div className="flex justify-end gap-2 pt-2 border-t border-border">
            <Button
              type="button"
              variant="ghost"
              onClick={() => handleOpenChange(false)}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={submitting || !name.trim()}>
              {submitting ? "Creating..." : "Create Agent"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
