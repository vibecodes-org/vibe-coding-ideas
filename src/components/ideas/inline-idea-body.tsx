"use client";

import { useState, useRef, useEffect } from "react";
import { Github, ExternalLink, Pencil, Plus } from "lucide-react";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Markdown } from "@/components/ui/markdown";
import { toast } from "sonner";
import { updateIdeaFields } from "@/actions/ideas";

interface InlineIdeaBodyProps {
  ideaId: string;
  description: string;
  githubUrl: string | null;
  isAuthor: boolean;
}

export function InlineIdeaBody({
  ideaId,
  description: initialDescription,
  githubUrl: initialGithubUrl,
  isAuthor,
}: InlineIdeaBodyProps) {
  const [description, setDescription] = useState(initialDescription);
  const [editingDescription, setEditingDescription] = useState(false);
  const previousDescRef = useRef(initialDescription);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Sync local state when the server prop changes (e.g. after AI enhance + router.refresh)
  useEffect(() => {
    if (!editingDescription) {
      setDescription(initialDescription);
      previousDescRef.current = initialDescription;
    }
  }, [initialDescription, editingDescription]);

  const [githubUrl, setGithubUrl] = useState(initialGithubUrl ?? "");
  const [editingGithubUrl, setEditingGithubUrl] = useState(false);
  const previousGithubRef = useRef(initialGithubUrl ?? "");

  // Description editing
  function startEditingDescription() {
    if (!isAuthor) return;
    setEditingDescription(true);
    requestAnimationFrame(() => textareaRef.current?.focus());
  }

  async function handleDescriptionBlur() {
    setEditingDescription(false);
    const trimmed = description.trim();
    if (trimmed === previousDescRef.current) return;
    if (!trimmed) {
      setDescription(previousDescRef.current);
      return;
    }
    try {
      await updateIdeaFields(ideaId, { description: trimmed });
      previousDescRef.current = trimmed;
    } catch {
      toast.error("Failed to update description");
      setDescription(previousDescRef.current);
    }
  }

  function handleDescriptionKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Escape") {
      setDescription(previousDescRef.current);
      setEditingDescription(false);
    }
  }

  // GitHub URL editing
  function startEditingGithub() {
    if (!isAuthor) return;
    setEditingGithubUrl(true);
  }

  async function handleGithubBlur() {
    setEditingGithubUrl(false);
    const trimmed = githubUrl.trim();
    if (trimmed === previousGithubRef.current) return;
    try {
      await updateIdeaFields(ideaId, { github_url: trimmed || null });
      previousGithubRef.current = trimmed;
    } catch {
      toast.error("Failed to update GitHub URL");
      setGithubUrl(previousGithubRef.current);
    }
  }

  function handleGithubKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter") {
      e.preventDefault();
      (e.target as HTMLInputElement).blur();
    } else if (e.key === "Escape") {
      setGithubUrl(previousGithubRef.current);
      setEditingGithubUrl(false);
    }
  }

  return (
    <div className="space-y-4">
      {/* GitHub URL */}
      {isAuthor ? (
        editingGithubUrl ? (
          <div>
            <Input
              value={githubUrl}
              onChange={(e) => setGithubUrl(e.target.value)}
              onBlur={handleGithubBlur}
              onKeyDown={handleGithubKeyDown}
              placeholder="https://github.com/..."
              autoFocus
              className="max-w-md"
            />
          </div>
        ) : githubUrl ? (
          <div className="group/github inline-flex items-center gap-2">
            <a
              href={githubUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm text-muted-foreground transition-colors hover:border-primary hover:text-foreground"
            >
              <Github className="h-4 w-4" />
              View Repository
              <ExternalLink className="h-3 w-3" />
            </a>
            <button
              onClick={startEditingGithub}
              className="text-muted-foreground opacity-0 group-hover/github:opacity-100 transition-opacity hover:text-foreground"
            >
              <Pencil className="h-3.5 w-3.5" />
            </button>
          </div>
        ) : (
          <button
            onClick={startEditingGithub}
            className="inline-flex items-center gap-2 rounded-lg border border-dashed border-border px-3 py-2 text-sm text-muted-foreground transition-colors hover:border-primary hover:text-foreground"
          >
            <Github className="h-4 w-4" />
            <Plus className="h-3 w-3" />
            Add GitHub URL
          </button>
        )
      ) : (
        initialGithubUrl && (
          <a
            href={initialGithubUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm text-muted-foreground transition-colors hover:border-primary hover:text-foreground"
          >
            <Github className="h-4 w-4" />
            View Repository
            <ExternalLink className="h-3 w-3" />
          </a>
        )
      )}

      {/* Description */}
      {isAuthor ? (
        editingDescription ? (
          <div className="text-foreground/90 leading-relaxed">
            <Textarea
              ref={textareaRef}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              onBlur={handleDescriptionBlur}
              onKeyDown={handleDescriptionKeyDown}
              rows={12}
              className="min-h-[200px] resize-y"
            />
            <p className="mt-1 text-xs text-muted-foreground">
              Supports Markdown. Press Escape to cancel.
            </p>
          </div>
        ) : (
          <div
            onClick={startEditingDescription}
            className="text-foreground/90 leading-relaxed cursor-text rounded-md border border-transparent px-2 py-1 -mx-2 -my-1 transition-colors hover:border-border hover:bg-muted/30"
          >
            <Markdown>{description}</Markdown>
          </div>
        )
      ) : (
        <div className="text-foreground/90 leading-relaxed">
          <Markdown>{initialDescription}</Markdown>
        </div>
      )}
    </div>
  );
}
