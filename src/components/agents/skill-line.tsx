import { cn } from "@/lib/utils";
import { skillLineLabel } from "@/lib/skill-line";

/** One line: "⚡ 1 skill: name" (names cut with an ellipsis if they run out of room) or a muted "⚡ No skills". */
export function SkillLine({ names, className }: { names: readonly string[]; className?: string }) {
  const label = skillLineLabel(names);
  if (!label) {
    return (
      <div className={cn("flex min-w-0 items-center gap-1.5 text-[11px] text-muted-foreground/75", className)}>
        <span aria-hidden>&#9889;</span>
        <span>No skills</span>
      </div>
    );
  }
  return (
    <div className={cn("flex min-w-0 items-center gap-1.5 text-[11px] text-muted-foreground", className)}>
      <span aria-hidden className="text-amber-400">&#9889;</span>
      <span className="shrink-0">{label.lead}</span>
      <span className="min-w-0 truncate font-mono text-foreground" title={label.names}>
        {label.names}
      </span>
    </div>
  );
}
