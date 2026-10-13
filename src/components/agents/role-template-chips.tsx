"use client";

import { useState } from "react";
import { Label } from "@/components/ui/label";
import { ROLE_TEMPLATE_CHIPS } from "@/lib/constants";
import { cn } from "@/lib/utils";

interface RoleTemplateChipsProps {
  selected: string | null;
  onSelect: (role: string) => void;
}

const PRIMARY = ROLE_TEMPLATE_CHIPS.filter((c) => c.group === "primary");
const MORE = ROLE_TEMPLATE_CHIPS.filter((c) => c.group === "more");

const chipClass = (on: boolean) =>
  cn(
    "flex flex-col items-center gap-0.5 rounded-md border py-2 px-2 text-xs font-medium transition-colors",
    on
      ? "border-violet-500 bg-violet-500/15 text-violet-400"
      : "border-border text-muted-foreground hover:border-violet-500/30 hover:text-foreground"
  );

/** "Start from a template": the one shared chip list for the create and admin screens. */
export function RoleTemplateChips({ selected, onSelect }: RoleTemplateChipsProps) {
  const [showMore, setShowMore] = useState(false);

  return (
    <div className="space-y-2">
      <Label className="text-xs">Start from a template</Label>
      <div className={cn("grid grid-cols-2 gap-1.5", MORE.length > 0 ? "sm:grid-cols-4" : "sm:grid-cols-5")}>
        {PRIMARY.map((t) => (
          <button key={t.role} type="button" onClick={() => onSelect(t.role)} className={chipClass(selected === t.role)}>
            <span className="text-base">{t.icon}</span>
            {t.role}
          </button>
        ))}
        {MORE.length > 0 && (
          <button
            type="button"
            onClick={() => setShowMore((v) => !v)}
            aria-expanded={showMore}
            className="flex flex-col items-center gap-0.5 rounded-md border border-dashed py-2 px-2 text-xs font-medium text-muted-foreground transition-colors hover:border-violet-500/30 hover:text-foreground"
          >
            <span className="text-base">{showMore ? "↑" : "+"}</span>
            {showMore ? "Less" : "More…"}
          </button>
        )}
      </div>
      {MORE.length > 0 && showMore && (
        <div
          className="grid grid-cols-2 gap-1.5 border-t border-dashed border-border pt-2 sm:grid-cols-4"
          role="group"
          aria-label="Additional role templates"
        >
          {MORE.map((t) => (
            <button key={t.role} type="button" onClick={() => onSelect(t.role)} className={chipClass(selected === t.role)}>
              <span className="text-base">{t.icon}</span>
              {t.role}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
