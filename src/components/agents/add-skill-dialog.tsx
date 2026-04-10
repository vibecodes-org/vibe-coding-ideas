"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  Globe,
  FileText,
  Loader2,
  Search,
  Check,
  Link2,
  Upload,
  AlertTriangle,
  ExternalLink,
  ArrowLeft,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { addSkillToAgent, fetchSkillsDirectory, importAgentFromUrl } from "@/actions/bots";
import { parseSkillMd } from "@/lib/skill-md";
import type { SkillDirectoryEntry } from "@/lib/skills-directory";
import { cn } from "@/lib/utils";

interface AddSkillDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  botId: string;
  botName: string;
  existingSkillNames: string[];
}

type TabKey = "browse" | "file";

const CATEGORIES = ["All", "Development", "Creative", "Enterprise", "Document"] as const;

function getCategoryBadgeClass(category: string | null): string {
  switch (category) {
    case "Development": return "bg-violet-500/12 text-violet-400 border-violet-500/25";
    case "Creative": return "bg-amber-500/12 text-amber-400 border-amber-500/25";
    case "Enterprise": return "bg-pink-500/12 text-pink-400 border-pink-500/25";
    case "Document": return "bg-cyan-500/12 text-cyan-400 border-cyan-500/25";
    default: return "bg-muted text-muted-foreground";
  }
}

export function AddSkillDialog({
  open,
  onOpenChange,
  botId,
  botName,
  existingSkillNames,
}: AddSkillDialogProps) {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [tab, setTab] = useState<TabKey>("browse");
  const [dirLoading, setDirLoading] = useState(false);
  const [urlLoading, setUrlLoading] = useState(false);
  const [adding, setAdding] = useState<string | null>(null);
  const [addedNames, setAddedNames] = useState<Set<string>>(new Set(existingSkillNames));

  // Browse state
  const [skills, setSkills] = useState<SkillDirectoryEntry[]>([]);
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("All");
  const [fetchError, setFetchError] = useState(false);
  const [selectedSkill, setSelectedSkill] = useState<SkillDirectoryEntry | null>(null);

  // File/URL state
  const [url, setUrl] = useState("");
  const [isDragging, setIsDragging] = useState(false);
  const dragCounterRef = useRef(0);

  // Fetch directory on open
  useEffect(() => {
    if (open && skills.length === 0) {
      setDirLoading(true);
      fetchSkillsDirectory()
        .then((entries) => {
          setSkills(entries);
          setFetchError(false);
        })
        .catch(() => {
          setFetchError(true);
        })
        .finally(() => setDirLoading(false));
    }
  }, [open, skills.length]);

  // Update addedNames when existingSkillNames changes
  useEffect(() => {
    setAddedNames(new Set(existingSkillNames));
  }, [existingSkillNames]);

  function handleClose(isOpen: boolean) {
    onOpenChange(isOpen);
    if (!isOpen) {
      setSearch("");
      setCategory("All");
      setUrl("");
      setIsDragging(false);
      setSelectedSkill(null);
      dragCounterRef.current = 0;
    }
  }

  // --- Add skill from directory ---

  async function handleAddFromDirectory(skill: SkillDirectoryEntry) {
    setAdding(skill.name);
    try {
      await addSkillToAgent(botId, {
        name: skill.name,
        description: skill.description,
        content: skill.content,
        source_url: skill.source_url,
        category: skill.category,
        source_type: "github",
      });
      setAddedNames((prev) => new Set([...prev, skill.name]));
      toast.success(`Added "${skill.name}" to ${botName}`);
      router.refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to add skill");
    } finally {
      setAdding(null);
    }
  }

  // --- Add skill from file ---

  const addFromParsed = useCallback(
    async (name: string, description: string, content: string, sourceType: "file" | "url", sourceUrl?: string) => {
      setAdding(name);
      try {
        await addSkillToAgent(botId, {
          name,
          description,
          content,
          source_url: sourceUrl ?? null,
          category: null,
          source_type: sourceType,
        });
        setAddedNames((prev) => new Set([...prev, name]));
        toast.success(`Added "${name}" to ${botName}`);
        router.refresh();
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Failed to add skill");
      } finally {
        setAdding(null);
      }
    },
    [botId, botName, router]
  );

  function handleFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    readFile(file);
    e.target.value = "";
  }

  function readFile(file: File) {
    if (!file.name.toLowerCase().endsWith(".md")) {
      toast.error("Please select a .md file");
      return;
    }
    if (file.size > 50000) {
      toast.error("File too large (max 50KB)");
      return;
    }
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const text = e.target?.result as string;
        const parsed = parseSkillMd(text);
        addFromParsed(parsed.name, parsed.description, parsed.body, "file");
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Failed to parse SKILL.md");
      }
    };
    reader.readAsText(file);
  }

  async function handleFetch() {
    if (!url.trim()) return;
    setUrlLoading(true);
    try {
      const parsed = await importAgentFromUrl(url.trim());
      await addFromParsed(parsed.name, parsed.description, parsed.body, "url", url.trim());
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to fetch URL");
    } finally {
      setUrlLoading(false);
    }
  }

  // --- Filtering ---

  const filtered = skills.filter((s) => {
    if (category !== "All" && s.category !== category) return false;
    if (search) {
      const q = search.toLowerCase();
      return s.name.toLowerCase().includes(q) || s.description.toLowerCase().includes(q);
    }
    return true;
  });

  // --- Render ---

  const tabs: { key: TabKey; label: string; icon: React.ReactNode }[] = [
    { key: "browse", label: "Browse Directory", icon: <Globe className="h-3.5 w-3.5" /> },
    { key: "file", label: "From File / URL", icon: <FileText className="h-3.5 w-3.5" /> },
  ];

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-lg max-h-[80vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <span className="text-base">&#x26A1;</span>
            Add Skill to {botName}
          </DialogTitle>
          <DialogDescription>
            Browse community skills or import from a file. Skills give your
            agent specialised knowledge for specific tasks.
          </DialogDescription>
        </DialogHeader>

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
        <div className="flex-1 overflow-y-auto py-1">
          {tab === "browse" && (
            <div className="space-y-3">
              {/* Search */}
              <div className="relative">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                <Input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search skills..."
                  className="pl-8 h-8 text-xs"
                />
              </div>

              {/* Category chips */}
              <div className="flex gap-1.5 flex-wrap">
                {CATEGORIES.map((cat) => (
                  <button
                    key={cat}
                    onClick={() => setCategory(cat)}
                    className={cn(
                      "rounded-full px-2.5 py-0.5 text-[11px] font-medium transition-colors border",
                      category === cat
                        ? "bg-violet-500/12 text-violet-400 border-violet-500/30"
                        : "text-muted-foreground border-border hover:text-foreground hover:border-border/80"
                    )}
                  >
                    {cat}
                  </button>
                ))}
              </div>

              {/* Fallback banner */}
              {fetchError && (
                <div className="flex items-center gap-2 rounded-lg border border-amber-500/20 bg-amber-500/5 px-3 py-2 text-xs text-amber-400">
                  <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                  Couldn&apos;t reach the skills directory. Showing recommended skills.
                </div>
              )}

              {/* Loading */}
              {dirLoading ? (
                <div className="flex items-center justify-center py-8">
                  <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                </div>
              ) : (
                <>
                  {/* Skill detail view */}
                  {selectedSkill ? (
                    <div className="space-y-3">
                      <button
                        onClick={() => setSelectedSkill(null)}
                        className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
                      >
                        <ArrowLeft className="h-3 w-3" />
                        Back to directory
                      </button>

                      <div className="rounded-lg border border-border bg-muted/20 p-4 space-y-3">
                        <div className="flex items-start justify-between gap-2">
                          <span className="font-mono text-sm font-medium">{selectedSkill.name}</span>
                          {selectedSkill.category && (
                            <Badge
                              variant="outline"
                              className={cn("text-[10px] shrink-0 border", getCategoryBadgeClass(selectedSkill.category))}
                            >
                              {selectedSkill.category}
                            </Badge>
                          )}
                        </div>

                        <p className="text-xs text-muted-foreground leading-relaxed">
                          {selectedSkill.description}
                        </p>

                        <div className="flex items-center gap-2 text-[10px] text-muted-foreground/60">
                          <span className="inline-flex items-center gap-1">
                            <svg viewBox="0 0 16 16" className="h-2.5 w-2.5 fill-current"><path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z"/></svg>
                            Anthropic
                          </span>
                          {selectedSkill.source_url && (
                            <a
                              href={selectedSkill.source_url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-violet-400 hover:underline inline-flex items-center gap-0.5"
                            >
                              View on GitHub <ExternalLink className="h-2 w-2" />
                            </a>
                          )}
                        </div>
                      </div>

                      {/* Instructions preview */}
                      <div>
                        <p className="text-[10px] font-medium text-muted-foreground mb-1.5">
                          Skill Instructions
                        </p>
                        <div className="relative max-h-[200px] overflow-hidden rounded-lg border border-border bg-background/50 p-3">
                          <pre className="whitespace-pre-wrap text-[11px] font-mono text-muted-foreground leading-relaxed">
                            {selectedSkill.content.slice(0, 2000)}
                            {selectedSkill.content.length > 2000 && "..."}
                          </pre>
                          {selectedSkill.content.length > 400 && (
                            <div className="pointer-events-none absolute inset-x-0 bottom-0 h-12 bg-gradient-to-t from-background/80 to-transparent" />
                          )}
                        </div>
                      </div>

                      {/* Add button */}
                      <div className="flex justify-end">
                        {addedNames.has(selectedSkill.name) ? (
                          <span className="inline-flex items-center gap-1.5 text-xs font-medium text-emerald-500">
                            <Check className="h-3.5 w-3.5" /> Added to {botName}
                          </span>
                        ) : (
                          <Button
                            size="sm"
                            className="bg-emerald-500/12 text-emerald-400 border border-emerald-500/25 hover:bg-emerald-500/20"
                            onClick={() => handleAddFromDirectory(selectedSkill)}
                            disabled={adding === selectedSkill.name}
                          >
                            {adding === selectedSkill.name ? (
                              <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />
                            ) : null}
                            Add to {botName}
                          </Button>
                        )}
                      </div>
                    </div>
                  ) : (
                  <>
                  {/* Skills grid */}
                  <div className="grid grid-cols-2 gap-2 max-h-[280px] overflow-y-auto pr-1">
                    {filtered.map((skill) => {
                      const isAdded = addedNames.has(skill.name);
                      const isAdding = adding === skill.name;

                      return (
                        <div
                          key={skill.name}
                          className="rounded-lg border border-border bg-muted/20 p-3 space-y-1.5 cursor-pointer hover:border-violet-500/30 transition-colors"
                          onClick={() => setSelectedSkill(skill)}
                        >
                          <div className="flex items-start justify-between gap-1">
                            <span className="font-mono text-xs font-medium truncate">
                              {skill.name}
                            </span>
                            {skill.category && (
                              <Badge
                                variant="outline"
                                className={cn("text-[9px] shrink-0 border", getCategoryBadgeClass(skill.category))}
                              >
                                {skill.category}
                              </Badge>
                            )}
                          </div>
                          <p className="text-[11px] text-muted-foreground leading-snug line-clamp-2">
                            {skill.description}
                          </p>
                          <div className="flex items-center justify-between pt-0.5">
                            <span className="text-[10px] text-muted-foreground/60 flex items-center gap-1">
                              <svg viewBox="0 0 16 16" className="h-2.5 w-2.5 fill-current"><path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z"/></svg>
                              Anthropic
                            </span>
                            {isAdded ? (
                              <span className="inline-flex items-center gap-1 text-[10px] font-medium text-emerald-500">
                                <Check className="h-3 w-3" /> Added
                              </span>
                            ) : (
                              <Button
                                size="sm"
                                className="h-6 px-2 text-[10px] bg-emerald-500/12 text-emerald-400 border border-emerald-500/25 hover:bg-emerald-500/20"
                                onClick={(e) => { e.stopPropagation(); handleAddFromDirectory(skill); }}
                                disabled={isAdding}
                              >
                                {isAdding ? (
                                  <Loader2 className="h-3 w-3 animate-spin" />
                                ) : (
                                  `Add to ${botName}`
                                )}
                              </Button>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>

                  {filtered.length === 0 && !dirLoading && (
                    <p className="text-center text-xs text-muted-foreground py-6">
                      No skills match your search.
                    </p>
                  )}

                  {/* Explore link */}
                  <div className="flex items-center justify-center gap-1.5 pt-2 text-xs text-muted-foreground">
                    Discover 91,000+ community skills on{" "}
                    <a
                      href="https://skills.sh"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-violet-400 hover:underline inline-flex items-center gap-0.5"
                    >
                      skills.sh <ExternalLink className="h-2.5 w-2.5" />
                    </a>
                  </div>
                  </>
                  )}
                </>
              )}
            </div>
          )}

          {tab === "file" && (
            <div className="space-y-3">
              {/* Drop zone */}
              <div
                className={cn(
                  "flex flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed p-6 transition-colors cursor-pointer",
                  isDragging
                    ? "border-primary bg-primary/5"
                    : "border-border hover:border-muted-foreground/30"
                )}
                onClick={() => fileInputRef.current?.click()}
                onDragEnter={(e) => { e.preventDefault(); dragCounterRef.current++; setIsDragging(true); }}
                onDragLeave={(e) => { e.preventDefault(); dragCounterRef.current--; if (dragCounterRef.current === 0) setIsDragging(false); }}
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => {
                  e.preventDefault();
                  dragCounterRef.current = 0;
                  setIsDragging(false);
                  const file = e.dataTransfer.files?.[0];
                  if (file) readFile(file);
                }}
              >
                <Upload className="h-6 w-6 text-muted-foreground/40" />
                <div className="text-center">
                  <p className="text-xs font-medium">
                    Drop a SKILL.md file here, or click to browse
                  </p>
                  <p className="text-[10px] text-muted-foreground mt-0.5">
                    Accepts .md files following the Agent Skills standard
                  </p>
                </div>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".md"
                  className="hidden"
                  onChange={handleFileSelect}
                />
              </div>

              {/* URL input */}
              <div className="flex gap-2">
                <div className="relative flex-1">
                  <Link2 className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                  <Input
                    value={url}
                    onChange={(e) => setUrl(e.target.value)}
                    placeholder="https://raw.githubusercontent.com/.../SKILL.md"
                    className="pl-8 h-8 text-xs font-mono"
                    onKeyDown={(e) => { if (e.key === "Enter") handleFetch(); }}
                  />
                </div>
                <Button
                  size="sm"
                  className="h-8"
                  onClick={handleFetch}
                  disabled={!url.trim() || urlLoading}
                >
                  {urlLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Fetch"}
                </Button>
              </div>
              <p className="text-[10px] text-muted-foreground">
                Paste a raw GitHub URL or any direct link to a SKILL.md file.
              </p>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
