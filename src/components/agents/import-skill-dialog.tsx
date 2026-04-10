"use client";

import { useState, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  Upload,
  Link2,
  Globe,
  Loader2,
  AlertTriangle,
  FileText,
  Check,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { RoleCombobox } from "@/components/ui/role-combobox";
import { importAgentFromSkill, importAgentFromUrl, checkDuplicateAgent, updateBot } from "@/actions/bots";
import { parseSkillMd, inferRole } from "@/lib/skill-md";
import type { ParsedSkill } from "@/lib/skill-md";
import { cn } from "@/lib/utils";

type TabKey = "upload" | "url" | "browse";
type Stage = "input" | "preview";

interface ImportSkillDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function ImportSkillDialog({ open, onOpenChange }: ImportSkillDialogProps) {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [tab, setTab] = useState<TabKey>("upload");
  const [stage, setStage] = useState<Stage>("input");
  const [loading, setLoading] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const dragCounterRef = useRef(0);

  // URL tab
  const [url, setUrl] = useState("");

  // Preview state
  const [parsed, setParsed] = useState<ParsedSkill | null>(null);
  const [role, setRole] = useState("");
  const [duplicate, setDuplicate] = useState<{
    exists: boolean;
    existingId?: string;
    existingName?: string;
  } | null>(null);
  const [duplicateChoice, setDuplicateChoice] = useState<"update" | "create" | null>(null);
  const [creating, setCreating] = useState(false);

  function resetAll() {
    setTab("upload");
    setStage("input");
    setLoading(false);
    setUrl("");
    setParsed(null);
    setRole("");
    setDuplicate(null);
    setDuplicateChoice(null);
    setCreating(false);
    setIsDragging(false);
    dragCounterRef.current = 0;
  }

  function handleClose(isOpen: boolean) {
    onOpenChange(isOpen);
    if (!isOpen) resetAll();
  }

  const showPreview = useCallback(
    async (skill: ParsedSkill) => {
      setParsed(skill);
      setRole(skill.metadata.role ?? inferRole(skill) ?? "");
      setStage("preview");

      // Check for duplicates (pass sourceId for round-trip detection)
      try {
        const sourceId = skill.metadata.source === "vibecodes" ? skill.metadata.source_id : undefined;
        const dup = await checkDuplicateAgent(skill.name, sourceId);
        setDuplicate(dup);
      } catch {
        // Non-critical — proceed without duplicate detection
      }
    },
    []
  );

  // --- File upload handlers ---

  function handleFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    readFile(file);
    // Reset so same file can be re-selected
    e.target.value = "";
  }

  function readFile(file: File) {
    if (!file.name.endsWith(".md")) {
      toast.error("Please select a .md file");
      return;
    }
    if (file.size > 50000) {
      toast.error("File too large (max 50KB)");
      return;
    }
    setLoading(true);
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const text = e.target?.result as string;
        const skill = parseSkillMd(text);
        showPreview(skill);
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Failed to parse SKILL.md");
      } finally {
        setLoading(false);
      }
    };
    reader.readAsText(file);
  }

  function handleDragEnter(e: React.DragEvent) {
    e.preventDefault();
    dragCounterRef.current++;
    setIsDragging(true);
  }

  function handleDragLeave(e: React.DragEvent) {
    e.preventDefault();
    dragCounterRef.current--;
    if (dragCounterRef.current === 0) setIsDragging(false);
  }

  function handleDragOver(e: React.DragEvent) {
    e.preventDefault();
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    dragCounterRef.current = 0;
    setIsDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file) readFile(file);
  }

  // --- URL fetch handler ---

  async function handleFetch() {
    if (!url.trim()) return;
    setLoading(true);
    try {
      const skill = await importAgentFromUrl(url.trim());
      await showPreview(skill);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to fetch URL");
    } finally {
      setLoading(false);
    }
  }

  // --- Import handler ---

  async function handleImport() {
    if (!parsed) return;
    setCreating(true);

    try {
      const skillWithRole = {
        ...parsed,
        metadata: { ...parsed.metadata, role: role || undefined },
      };

      const shouldUpdate = duplicate?.exists && duplicateChoice === "update";
      const botId = await importAgentFromSkill(
        skillWithRole,
        shouldUpdate ? duplicate.existingId : undefined
      );

      toast.success(
        shouldUpdate
          ? `Updated agent "${duplicate.existingName}"`
          : "Agent created from SKILL.md"
      );
      handleClose(false);
      router.refresh();
      router.push(`/agents/${botId}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to import agent");
    } finally {
      setCreating(false);
    }
  }

  // --- Render ---

  const tabs: { key: TabKey; label: string; icon: React.ReactNode }[] = [
    { key: "upload", label: "Upload File", icon: <Upload className="h-3.5 w-3.5" /> },
    { key: "url", label: "From URL", icon: <Link2 className="h-3.5 w-3.5" /> },
    { key: "browse", label: "Browse Directory", icon: <Globe className="h-3.5 w-3.5" /> },
  ];

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-lg max-h-[80vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileText className="h-5 w-5 text-violet-400" />
            Import Agent
          </DialogTitle>
          <DialogDescription>
            Import an agent definition from a SKILL.md file — the{" "}
            <span className="font-medium text-foreground">Agent Skills</span>{" "}
            open standard.
          </DialogDescription>
        </DialogHeader>

        {stage === "input" ? (
          <>
            {/* Tab bar */}
            <div className="flex gap-1 rounded-lg bg-muted/50 p-1" role="tablist">
              {tabs.map((t) => (
                <button
                  key={t.key}
                  role="tab"
                  aria-selected={tab === t.key}
                  onClick={() => setTab(t.key)}
                  className={cn(
                    "flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors flex-1 justify-center",
                    tab === t.key
                      ? "bg-background shadow-sm"
                      : "text-muted-foreground hover:text-foreground"
                  )}
                >
                  {t.icon}
                  {t.label}
                </button>
              ))}
            </div>

            {/* Tab content */}
            <div className="flex-1 py-2">
              {tab === "upload" && (
                <div
                  className={cn(
                    "flex flex-col items-center justify-center gap-3 rounded-lg border-2 border-dashed p-8 transition-colors cursor-pointer",
                    isDragging
                      ? "border-primary bg-primary/5"
                      : "border-border hover:border-muted-foreground/30"
                  )}
                  onClick={() => fileInputRef.current?.click()}
                  onDragEnter={handleDragEnter}
                  onDragLeave={handleDragLeave}
                  onDragOver={handleDragOver}
                  onDrop={handleDrop}
                >
                  {loading ? (
                    <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                  ) : (
                    <>
                      <FileText className="h-8 w-8 text-muted-foreground/60" />
                      <div className="text-center">
                        <p className="text-sm font-medium">
                          Drop a SKILL.md file here, or click to browse
                        </p>
                        <p className="text-xs text-muted-foreground mt-1">
                          Accepts .md files following the Agent Skills standard
                        </p>
                      </div>
                    </>
                  )}
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept=".md"
                    className="hidden"
                    onChange={handleFileSelect}
                  />
                </div>
              )}

              {tab === "url" && (
                <div className="space-y-3">
                  <div className="flex gap-2">
                    <Input
                      value={url}
                      onChange={(e) => setUrl(e.target.value)}
                      placeholder="https://raw.githubusercontent.com/.../SKILL.md"
                      className="font-mono text-xs"
                      onKeyDown={(e) => {
                        if (e.key === "Enter") handleFetch();
                      }}
                    />
                    <Button
                      size="sm"
                      onClick={handleFetch}
                      disabled={!url.trim() || loading}
                    >
                      {loading ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        "Fetch"
                      )}
                    </Button>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Paste a raw GitHub URL, gist link, or any direct URL to a
                    SKILL.md file.
                  </p>
                </div>
              )}

              {tab === "browse" && (
                <div className="flex flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-border p-8">
                  <Globe className="h-8 w-8 text-muted-foreground/40" />
                  <div className="text-center">
                    <p className="text-sm font-medium text-muted-foreground">
                      Coming soon
                    </p>
                    <p className="text-xs text-muted-foreground mt-1">
                      Browse the Agent Skills directory to discover and import
                      community agents.
                    </p>
                  </div>
                </div>
              )}
            </div>
          </>
        ) : (
          /* Preview stage */
          parsed && (
            <div className="flex-1 space-y-4 overflow-y-auto py-2">
              {/* Name */}
              <div>
                <label className="text-xs font-medium text-muted-foreground">
                  Name
                </label>
                <p className="text-sm font-semibold mt-0.5">
                  {parsed.name
                    .split("-")
                    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
                    .join(" ")}
                </p>
              </div>

              {/* Role */}
              <div>
                <label className="text-xs font-medium text-muted-foreground">
                  Role
                </label>
                <div className="mt-0.5">
                  <RoleCombobox
                    value={role}
                    onChange={setRole}
                  />
                </div>
              </div>

              {/* Skills */}
              {parsed.metadata.tags && parsed.metadata.tags.length > 0 && (
                <div>
                  <label className="text-xs font-medium text-muted-foreground">
                    Skills
                  </label>
                  <div className="flex flex-wrap gap-1 mt-1">
                    {parsed.metadata.tags.map((tag) => (
                      <Badge
                        key={tag}
                        variant="outline"
                        className="text-[10px]"
                      >
                        {tag}
                      </Badge>
                    ))}
                  </div>
                </div>
              )}

              {/* System prompt preview */}
              <div>
                <label className="text-xs font-medium text-muted-foreground">
                  System Prompt Preview
                </label>
                <div className="relative mt-1 max-h-40 overflow-hidden rounded-lg border border-border bg-muted/30 p-3">
                  <pre className="whitespace-pre-wrap text-xs font-mono text-muted-foreground leading-relaxed">
                    {parsed.body.slice(0, 500)}
                    {parsed.body.length > 500 && "..."}
                  </pre>
                  {parsed.body.length > 300 && (
                    <div className="pointer-events-none absolute inset-x-0 bottom-0 h-12 bg-gradient-to-t from-muted/80 to-transparent" />
                  )}
                </div>
              </div>

              {/* Duplicate detection */}
              {duplicate?.exists && (
                <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 space-y-2">
                  <div className="flex items-center gap-2 text-sm font-medium text-amber-400">
                    <AlertTriangle className="h-4 w-4 shrink-0" />
                    Agent &ldquo;{duplicate.existingName}&rdquo; already exists
                  </div>
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      variant={duplicateChoice === "update" ? "default" : "outline"}
                      className="text-xs"
                      onClick={() => setDuplicateChoice("update")}
                    >
                      {duplicateChoice === "update" && (
                        <Check className="mr-1 h-3 w-3" />
                      )}
                      Update Existing
                    </Button>
                    <Button
                      size="sm"
                      variant={duplicateChoice === "create" ? "default" : "outline"}
                      className="text-xs"
                      onClick={() => setDuplicateChoice("create")}
                    >
                      {duplicateChoice === "create" && (
                        <Check className="mr-1 h-3 w-3" />
                      )}
                      Create New
                    </Button>
                  </div>
                </div>
              )}
            </div>
          )
        )}

        {stage === "preview" && (
          <DialogFooter className="gap-2 sm:gap-0">
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setStage("input");
                setParsed(null);
                setDuplicate(null);
                setDuplicateChoice(null);
              }}
            >
              Back
            </Button>
            <Button
              size="sm"
              onClick={handleImport}
              disabled={
                creating || (duplicate?.exists === true && !duplicateChoice)
              }
            >
              {creating ? (
                <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
              ) : null}
              {duplicate?.exists && duplicateChoice === "update"
                ? "Update Agent"
                : "Create Agent"}
            </Button>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  );
}
