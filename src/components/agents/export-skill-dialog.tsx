"use client";

import { useState } from "react";
import { Check, Copy, Download, FileText, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { exportAgentAsSkill } from "@/actions/bots";
import { skillFilename } from "@/lib/skill-md";

interface ExportSkillDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  botId: string;
  botName: string;
}

export function ExportSkillDialog({
  open,
  onOpenChange,
  botId,
  botName,
}: ExportSkillDialogProps) {
  const [skillMd, setSkillMd] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);

  async function handleOpen(isOpen: boolean) {
    onOpenChange(isOpen);
    if (isOpen && !skillMd) {
      setLoading(true);
      try {
        const content = await exportAgentAsSkill(botId);
        setSkillMd(content);
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Failed to export agent");
        onOpenChange(false);
      } finally {
        setLoading(false);
      }
    }
    if (!isOpen) {
      setSkillMd(null);
      setCopied(false);
    }
  }

  function handleCopy() {
    if (!skillMd) return;
    navigator.clipboard.writeText(skillMd);
    setCopied(true);
    toast.success("Copied to clipboard");
    setTimeout(() => setCopied(false), 2000);
  }

  function handleDownload() {
    if (!skillMd) return;
    const blob = new Blob([skillMd], { type: "text/markdown" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = skillFilename(botName);
    a.click();
    URL.revokeObjectURL(url);
    toast.success(`Downloaded ${skillFilename(botName)}`);
  }

  return (
    <Dialog open={open} onOpenChange={handleOpen}>
      <DialogContent className="max-w-2xl max-h-[80vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileText className="h-5 w-5 text-blue-400" />
            Export as Skill
          </DialogTitle>
          <DialogDescription>
            SKILL.md format — compatible with Claude Code, Cursor, Copilot, and
            12+ other tools via the{" "}
            <span className="font-medium text-foreground">Agent Skills</span>{" "}
            open standard.
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : skillMd ? (
          <div className="flex-1 overflow-y-auto rounded-lg border border-border bg-muted/30 p-4">
            <pre className="whitespace-pre-wrap text-xs font-mono text-muted-foreground leading-relaxed">
              {skillMd}
            </pre>
          </div>
        ) : null}

        <DialogFooter className="gap-2 sm:gap-0">
          <Button variant="outline" size="sm" onClick={handleCopy} disabled={!skillMd}>
            {copied ? (
              <Check className="mr-1.5 h-3.5 w-3.5 text-emerald-500" />
            ) : (
              <Copy className="mr-1.5 h-3.5 w-3.5" />
            )}
            {copied ? "Copied" : "Copy"}
          </Button>
          <Button size="sm" onClick={handleDownload} disabled={!skillMd}>
            <Download className="mr-1.5 h-3.5 w-3.5" />
            Download
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
