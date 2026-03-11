"use client";

import { useState, useEffect } from "react";
import { toast } from "sonner";
import { Lock, ChevronDown, ChevronRight, Check, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { listLibraryTemplates } from "@/actions/admin-templates";
import { createWorkflowTemplate } from "@/actions/workflow-templates";
import type { WorkflowLibraryTemplate } from "@/types";
import type { WorkflowTemplateStep } from "@/types/database";

function getRoleBadgeClasses(role: string): string {
  const r = role.toLowerCase();
  if (/\bba\b|business|analyst|product|pm\b/.test(r))
    return "bg-blue-500/15 text-blue-400 border-blue-500/25";
  if (/\bux\b|design|ui\b|front|css/.test(r))
    return "bg-pink-500/15 text-pink-400 border-pink-500/25";
  if (/\bdev\b|engineer|code|back|full/.test(r))
    return "bg-violet-500/15 text-violet-400 border-violet-500/25";
  if (/\bqa\b|test|quality/.test(r))
    return "bg-cyan-500/15 text-cyan-400 border-cyan-500/25";
  if (/\bhuman\b|review|approv|manual/.test(r))
    return "bg-amber-500/15 text-amber-400 border-amber-500/25";
  return "bg-zinc-500/15 text-zinc-400 border-zinc-500/25";
}

interface ImportTemplateLibraryDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  ideaId: string;
  existingTemplateNames: string[];
  onImported: () => void;
}

export function ImportTemplateLibraryDialog({
  open,
  onOpenChange,
  ideaId,
  existingTemplateNames,
  onImported,
}: ImportTemplateLibraryDialogProps) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [importing, setImporting] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [templates, setTemplates] = useState<WorkflowLibraryTemplate[]>([]);
  const [loading, setLoading] = useState(false);

  const existingNames = new Set(existingTemplateNames.map((n) => n.toLowerCase()));

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    listLibraryTemplates(true)
      .then((data) => setTemplates(data))
      .catch(() => toast.error("Failed to load template library"))
      .finally(() => setLoading(false));
  }, [open]);

  function isAlreadyImported(tpl: WorkflowLibraryTemplate) {
    return existingNames.has(tpl.name.toLowerCase());
  }

  function toggleSelected(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }

  function toggleExpanded(id: string) {
    setExpandedId((prev) => (prev === id ? null : id));
  }

  async function handleImport() {
    if (selected.size === 0) return;
    setImporting(true);

    const toImport = templates.filter((tpl) => selected.has(tpl.id));
    const results = await Promise.allSettled(
      toImport.map((tpl) =>
        createWorkflowTemplate(ideaId, tpl.name, tpl.description, tpl.steps as WorkflowTemplateStep[])
      )
    );

    const succeeded = results.filter((r) => r.status === "fulfilled").length;
    const failed = results.filter((r) => r.status === "rejected").length;

    if (succeeded > 0) {
      toast.success(`Imported ${succeeded} template${succeeded !== 1 ? "s" : ""}`);
    }
    if (failed > 0) {
      toast.error(`Failed to import ${failed} template${failed !== 1 ? "s" : ""}`);
    }

    setImporting(false);
    setSelected(new Set());
    onOpenChange(false);
    onImported();
  }

  function handleOpenChange(nextOpen: boolean) {
    if (!nextOpen) {
      setSelected(new Set());
      setExpandedId(null);
    }
    onOpenChange(nextOpen);
  }

  const gateCount = (steps: WorkflowTemplateStep[]) =>
    steps.filter((s) => s.requires_approval).length;

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-lg max-h-[80vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>Template Library</DialogTitle>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto space-y-2 py-2">
          {loading ? (
            <div className="flex items-center justify-center py-8 text-muted-foreground">
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Loading templates...
            </div>
          ) : templates.length === 0 ? (
            <div className="py-8 text-center text-sm text-muted-foreground">
              No templates available in the library yet.
            </div>
          ) : (
            templates.map((tpl) => {
              const imported = isAlreadyImported(tpl);
              const isSelected = selected.has(tpl.id);
              const isExpanded = expandedId === tpl.id;
              const steps = tpl.steps as WorkflowTemplateStep[];
              const gates = gateCount(steps);

              return (
                <div key={tpl.id} className="rounded-lg border border-border overflow-hidden">
                  {/* Card header */}
                  <div
                    className={`flex items-start gap-3 px-3 py-2.5 cursor-pointer transition-colors ${
                      isSelected
                        ? "bg-violet-500/10 border-violet-500/25"
                        : imported
                          ? "bg-muted/30 opacity-60"
                          : "hover:bg-muted/30"
                    }`}
                    onClick={() => {
                      if (!imported) toggleSelected(tpl.id);
                    }}
                  >
                    {/* Checkbox */}
                    <div
                      className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded border ${
                        imported
                          ? "border-muted-foreground/30 bg-muted/50"
                          : isSelected
                            ? "border-violet-500 bg-violet-500"
                            : "border-muted-foreground/40"
                      }`}
                    >
                      {(isSelected || imported) && (
                        <Check className="h-3 w-3 text-white" />
                      )}
                    </div>

                    {/* Text */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium truncate">{tpl.name}</span>
                        {imported && (
                          <Badge
                            variant="outline"
                            className="shrink-0 text-[10px] border-emerald-500/25 bg-emerald-500/15 text-emerald-400"
                          >
                            Imported
                          </Badge>
                        )}
                      </div>
                      <p className="mt-0.5 text-xs text-muted-foreground line-clamp-2">
                        {tpl.description}
                      </p>
                      <p className="mt-1 text-[10px] text-muted-foreground">
                        {steps.length} step{steps.length !== 1 ? "s" : ""}
                        {gates > 0 && ` · ${gates} gate${gates !== 1 ? "s" : ""}`}
                      </p>
                    </div>

                    {/* Expand toggle */}
                    <button
                      type="button"
                      className="mt-0.5 shrink-0 rounded p-0.5 text-muted-foreground hover:text-foreground"
                      onClick={(e) => {
                        e.stopPropagation();
                        toggleExpanded(tpl.id);
                      }}
                    >
                      {isExpanded ? (
                        <ChevronDown className="h-4 w-4" />
                      ) : (
                        <ChevronRight className="h-4 w-4" />
                      )}
                    </button>
                  </div>

                  {/* Expanded step preview */}
                  {isExpanded && (
                    <div className="border-t border-border bg-muted/10 px-3 py-2 space-y-1">
                      {steps.map((step, sIdx) => (
                        <div
                          key={sIdx}
                          className="flex items-center gap-2 rounded px-2 py-1.5 text-xs"
                        >
                          <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-muted text-[10px] font-semibold text-muted-foreground">
                            {sIdx + 1}
                          </span>
                          <span className="flex-1 truncate">{step.title}</span>
                          <Badge
                            variant="outline"
                            className={`shrink-0 text-[10px] ${getRoleBadgeClasses(step.role)}`}
                          >
                            {step.role}
                          </Badge>
                          {step.requires_approval && (
                            <Lock className="h-3 w-3 shrink-0 text-amber-400" />
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>

        <DialogFooter>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => handleOpenChange(false)}
            disabled={importing}
          >
            Cancel
          </Button>
          <Button
            size="sm"
            disabled={selected.size === 0 || importing}
            onClick={handleImport}
          >
            {importing && <Loader2 className="mr-1 h-3 w-3 animate-spin" />}
            Import{selected.size > 0 ? ` (${selected.size})` : ""}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
