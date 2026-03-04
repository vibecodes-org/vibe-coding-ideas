"use client";

import { useState, useEffect, useRef } from "react";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  generatePromptFromFields,
  parsePromptToFields,
  type StructuredPromptFields,
} from "@/lib/prompt-builder";

interface PromptBuilderProps {
  role: string;
  value: string;
  onChange: (prompt: string) => void;
  templateStructured?: StructuredPromptFields | null;
}

const EMPTY_FIELDS: StructuredPromptFields = {
  goal: "",
  constraints: "",
  approach: "",
};

export function PromptBuilder({
  role,
  value,
  onChange,
  templateStructured,
}: PromptBuilderProps) {
  const [mode, setMode] = useState<"builder" | "raw">(() => {
    if (!value) return "builder";
    const parsed = parsePromptToFields(value);
    return parsed ? "builder" : "raw";
  });

  const [fields, setFields] = useState<StructuredPromptFields>(() => {
    if (!value) return { ...EMPTY_FIELDS };
    return parsePromptToFields(value) ?? { ...EMPTY_FIELDS };
  });

  // Track last generated text to detect manual raw edits
  const lastGenerated = useRef(value);
  const isInitialMount = useRef(true);

  // Regenerate prompt when role or fields change in builder mode
  useEffect(() => {
    if (mode === "builder") {
      const generated = generatePromptFromFields(role, fields);
      lastGenerated.current = generated;
      if (isInitialMount.current) {
        isInitialMount.current = false;
        return; // Don't call onChange on mount — preserve original format
      }
      onChange(generated);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [role, fields, mode]);

  // Handle template structured fields being passed from parent
  useEffect(() => {
    if (templateStructured) {
      setFields({ ...templateStructured });
      setMode("builder");
    }
  }, [templateStructured]);

  function updateField(key: keyof StructuredPromptFields, val: string) {
    setFields((prev) => ({ ...prev, [key]: val }));
  }

  function handleModeChange(newMode: string) {
    if (newMode === "raw") {
      // Builder → Raw: generated text already in value via onChange
      setMode("raw");
    } else {
      // Raw → Builder: try to parse current value
      const parsed = parsePromptToFields(value);
      if (parsed) {
        setFields(parsed);
      } else {
        setFields({ ...EMPTY_FIELDS });
      }
      setMode("builder");
    }
  }

  return (
    <div className="space-y-2">
      <Label>System Prompt</Label>
      <Tabs value={mode} onValueChange={handleModeChange}>
        <TabsList className="h-8 w-full">
          <TabsTrigger value="builder" className="text-xs">
            Builder
          </TabsTrigger>
          <TabsTrigger value="raw" className="text-xs">
            Raw
          </TabsTrigger>
        </TabsList>

        <TabsContent value="builder" className="mt-2 space-y-3">
          <div className="space-y-1">
            <Label htmlFor="prompt-goal" className="text-xs text-muted-foreground">
              Goal
            </Label>
            <Textarea
              id="prompt-goal"
              value={fields.goal}
              onChange={(e) => updateField("goal", e.target.value)}
              placeholder="e.g. Ship clean, tested code"
              rows={2}
              maxLength={500}
              className="text-sm"
            />
          </div>
          <div className="space-y-1">
            <Label
              htmlFor="prompt-constraints"
              className="text-xs text-muted-foreground"
            >
              Constraints
            </Label>
            <Textarea
              id="prompt-constraints"
              value={fields.constraints}
              onChange={(e) => updateField("constraints", e.target.value)}
              placeholder="e.g. Never skip tests or modify files outside scope"
              rows={2}
              maxLength={500}
              className="text-sm"
            />
          </div>
          <div className="space-y-1">
            <Label
              htmlFor="prompt-approach"
              className="text-xs text-muted-foreground"
            >
              Approach
            </Label>
            <Textarea
              id="prompt-approach"
              value={fields.approach}
              onChange={(e) => updateField("approach", e.target.value)}
              placeholder="e.g. Always write tests before implementation"
              rows={2}
              maxLength={500}
              className="text-sm"
            />
          </div>
        </TabsContent>

        <TabsContent value="raw" className="mt-2">
          <Textarea
            value={value}
            onChange={(e) => onChange(e.target.value)}
            placeholder="Instructions for this agent persona..."
            rows={6}
            maxLength={10000}
            className="text-sm"
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}
