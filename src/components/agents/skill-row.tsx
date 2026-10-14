"use client";

import { useState } from "react";
import { X } from "lucide-react";
import { Markdown } from "@/components/ui/markdown";
import { cn } from "@/lib/utils";
import { formatSkillSize } from "@/lib/format-skill-size";
import type { AgentSkill } from "@/types";

function sourceLabel(sourceType: string): string {
  if (sourceType === "github") return "From GitHub";
  if (sourceType === "file") return "File upload";
  if (sourceType === "url") return "URL import";
  return sourceType;
}

interface SkillRowProps {
  skill: AgentSkill;
  /** Owner only: shows the remove button. */
  onRemove?: () => void;
  removing?: boolean;
}

/** One skill on the agent page: full name, what it is for, size, source, date, and the exact text sent. */
export function SkillRow({ skill, onRemove, removing = false }: SkillRowProps) {
  const [open, setOpen] = useState(false);
  const added = new Date(skill.created_at).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
  const label = sourceLabel(skill.source_type);

  return (
    <div className="rounded-lg border border-border bg-muted/30 px-3 py-2.5" data-testid="skill-row">
      <div className="flex items-start gap-2.5">
        <div
          aria-hidden
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-amber-500/15 text-sm text-amber-400"
        >
          &#9889;
        </div>
        <div className="min-w-0 flex-1">
          <div className="break-words font-mono text-[12.5px] font-semibold">{skill.name}</div>
          {skill.description && (
            <p className="mt-px text-xs text-muted-foreground">{skill.description}</p>
          )}
          <div className="mt-1.5 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-[11px] text-muted-foreground">
            <span>{formatSkillSize(skill.content.length)}</span>
            <span aria-hidden>&bull;</span>
            {skill.source_url ? (
              <a
                href={skill.source_url}
                target="_blank"
                rel="noopener noreferrer"
                className="text-violet-400 hover:text-violet-300"
              >
                {label} &#8599;
              </a>
            ) : (
              <span>{label}</span>
            )}
            <span aria-hidden>&bull;</span>
            <span>Added {added}</span>
            <span aria-hidden>&bull;</span>
            <button
              type="button"
              aria-expanded={open}
              onClick={() => setOpen((v) => !v)}
              className="text-violet-400 hover:text-violet-300"
            >
              {open ? "Hide text ▴" : "Show text ▾"}
            </button>
          </div>
        </div>
        {onRemove && (
          <button
            type="button"
            aria-label={`Remove skill ${skill.name}`}
            title="Remove skill"
            className={cn(
              "flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-muted-foreground/60 transition-colors hover:bg-red-500/10 hover:text-red-400",
              removing && "pointer-events-none opacity-50"
            )}
            disabled={removing}
            onClick={onRemove}
          >
            <X className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
      {open && (
        <div
          className="mt-2.5 max-h-[28rem] overflow-y-auto rounded-md border border-dashed border-input px-3 py-2.5 text-xs leading-relaxed [&_h1]:!mb-1 [&_h1]:!mt-0 [&_h1]:!text-[13px] [&_h2]:!text-[13px] [&_h3]:!text-xs"
          data-testid="skill-text"
        >
          <Markdown>{skill.content}</Markdown>
        </div>
      )}
    </div>
  );
}
