import { stepSkillsLead } from "@/lib/skill-line";

/** What a not-yet-finished step will be sent: "⚡ Gets 1 skill with this step: name", or a quiet "⚡ No skills". */
export function StepSkillsLine({ names }: { names: string[] }) {
  if (names.length === 0) {
    return (
      <div className="mt-1 flex items-center gap-1.5 text-[11px] text-muted-foreground/75">
        <span aria-hidden>&#9889;</span>
        <span>No skills</span>
      </div>
    );
  }
  return (
    <div className="mt-1 flex min-w-0 flex-wrap items-center gap-x-1.5 text-[11px] text-muted-foreground">
      <span aria-hidden className="text-amber-400">&#9889;</span>
      <span>{stepSkillsLead(names.length)}</span>
      <span className="min-w-0 break-all font-mono text-foreground">{names.join(", ")}</span>
    </div>
  );
}
