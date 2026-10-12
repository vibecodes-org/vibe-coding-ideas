"use client";

import { useState, useEffect, useRef } from "react";
import { Info } from "lucide-react";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import {
  EMPTY_INSTRUCTIONS,
  INSTRUCTION_LIMITS,
  generateInstructions,
  parseInstructions,
  toGuidedFallback,
  type AgentInstructions,
} from "@/lib/agent-instructions";

interface AgentInstructionsEditorProps {
  value: string;
  onChange: (text: string) => void;
  /** The agent's role, so an old "You are a <role>." opening is recognised. */
  role?: string | null;
}

type Mode = "guided" | "raw";

export function AgentInstructionsEditor({ value, onChange, role }: AgentInstructionsEditorProps) {
  const initial = useRef(parseInstructions(value, role)).current;

  const [mode, setMode] = useState<Mode>(() => (!value.trim() || initial ? "guided" : "raw"));
  const [fields, setFields] = useState<AgentInstructions>(() => initial?.fields ?? { ...EMPTY_INSTRUCTIONS });
  const [showLegacyNotice, setShowLegacyNotice] = useState(initial?.source === "legacy");

  // An old-layout agent opens already converted, and saving stores the new
  // layout. New-layout and "neither" text emits nothing on mount, so merely
  // opening an agent never changes it.
  useEffect(() => {
    if (initial?.source === "legacy") onChange(generateInstructions(initial.fields));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function updateField(key: keyof AgentInstructions, text: string) {
    const next = { ...fields, [key]: text };
    setFields(next);
    onChange(generateInstructions(next));
  }

  function handleModeChange(next: string) {
    if (next === "raw") {
      setMode("raw");
      return;
    }
    const parsed = parseInstructions(value, role);
    if (parsed) {
      setFields(parsed.fields);
      if (parsed.source === "legacy") {
        setShowLegacyNotice(true);
        onChange(generateInstructions(parsed.fields));
      }
    } else if (value.trim()) {
      // Neither layout: keep every character, all of it in "Its job".
      const fallback = toGuidedFallback(value);
      setFields(fallback);
      onChange(generateInstructions(fallback));
    } else {
      setFields({ ...EMPTY_INSTRUCTIONS });
    }
    setMode("guided");
  }

  return (
    <div className="space-y-2">
      <Label className="text-xs">Instructions</Label>
      <Tabs value={mode} onValueChange={handleModeChange}>
        <TabsList className="h-8 w-full">
          <TabsTrigger value="guided" className="text-xs">
            Guided
          </TabsTrigger>
          <TabsTrigger value="raw" className="text-xs">
            Write it yourself
          </TabsTrigger>
        </TabsList>

        <TabsContent value="guided" className="mt-3 space-y-3">
          {showLegacyNotice && (
            <div
              role="status"
              className="flex items-start gap-2 rounded-md border border-violet-500/25 bg-violet-500/[0.06] px-2.5 py-2 text-xs text-violet-300"
            >
              <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <span>
                These instructions were in the old layout (Goal, Expertise, Constraints, Approach). They&apos;ve
                been moved into the boxes below and nothing is lost. Saving keeps the new layout.
              </span>
            </div>
          )}

          <div className="space-y-1">
            <Label htmlFor="instr-one-line" className="text-xs text-muted-foreground">
              What it does, in one line
            </Label>
            <Textarea
              id="instr-one-line"
              value={fields.oneLine}
              onChange={(e) => updateField("oneLine", e.target.value)}
              placeholder="e.g. You review code changes for correctness and consistency."
              rows={1}
              maxLength={INSTRUCTION_LIMITS.oneLine}
              className="min-h-0 resize-none text-sm"
            />
          </div>

          <div className="space-y-1">
            <Label htmlFor="instr-job" className="text-xs text-muted-foreground">
              Its job
            </Label>
            <p className="text-[11px] text-muted-foreground/80">
              The specific work it does in your workflows: what it reads, what it checks, the steps it follows.
            </p>
            <Textarea
              id="instr-job"
              value={fields.job}
              onChange={(e) => updateField("job", e.target.value)}
              placeholder={"e.g.\n1. Read the card and the code it touches.\n2. Check each acceptance criterion.\n3. Report what fails."}
              rows={6}
              maxLength={INSTRUCTION_LIMITS.job}
              className="text-sm"
            />
          </div>

          <div className="space-y-1">
            <Label htmlFor="instr-hand-back" className="text-xs text-muted-foreground">
              What it hands back
            </Label>
            <p className="text-[11px] text-muted-foreground/80">What the next step, or you, get from it.</p>
            <Textarea
              id="instr-hand-back"
              value={fields.handBack}
              onChange={(e) => updateField("handBack", e.target.value)}
              placeholder="e.g. Pass, or a numbered list of blocking issues with file and line, then any non-blocking notes."
              rows={2}
              maxLength={INSTRUCTION_LIMITS.handBack}
              className="text-sm"
            />
            {!fields.handBack.trim() && (showLegacyNotice || fields.leftover.trim()) && (
              <p className="text-[10.5px] text-amber-400">Not set yet. Old-layout agents never had this box.</p>
            )}
          </div>

          <div className="space-y-1">
            <Label htmlFor="instr-must-not" className="text-xs text-muted-foreground">
              What it must not do
            </Label>
            <Textarea
              id="instr-must-not"
              value={fields.mustNot}
              onChange={(e) => updateField("mustNot", e.target.value)}
              placeholder="e.g. Don't edit files. Don't approve without reading every changed file."
              rows={2}
              maxLength={INSTRUCTION_LIMITS.mustNot}
              className="text-sm"
            />
          </div>

          {fields.leftover.trim() && (
            <div className="rounded-lg border border-amber-500/25 bg-amber-500/[0.04] p-2.5">
              <div className="flex items-center justify-between gap-2">
                <Label htmlFor="instr-leftover" className="text-xs font-semibold text-amber-400">
                  Notes from the old format (was &quot;Expertise&quot;)
                </Label>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-6 px-2 text-xs"
                  onClick={() => updateField("leftover", "")}
                >
                  Clear
                </Button>
              </div>
              <p className="my-1.5 text-[11px] text-amber-200/70">
                The new layout leaves out general know-how a strong model already has. Move anything specific to
                your project into &quot;Its job&quot;, then clear this box. Whatever is left here stays in the
                agent&apos;s instructions.
              </p>
              <Textarea
                id="instr-leftover"
                value={fields.leftover}
                onChange={(e) => updateField("leftover", e.target.value)}
                rows={4}
                className="border-amber-500/20 text-xs"
              />
            </div>
          )}

          <p className="text-[10.5px] text-muted-foreground">
            Leave out general know-how a strong model already has. Skills hold what only your project knows.
          </p>
        </TabsContent>

        <TabsContent value="raw" className="mt-2">
          <Textarea
            aria-label="Instructions text"
            value={value}
            onChange={(e) => onChange(e.target.value)}
            placeholder="Instructions for this agent..."
            rows={10}
            maxLength={INSTRUCTION_LIMITS.raw}
            className="text-sm"
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}
