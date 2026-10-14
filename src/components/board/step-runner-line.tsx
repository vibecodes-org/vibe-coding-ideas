import Link from "next/link";
import { cn, getInitials } from "@/lib/utils";
import { getRoleColor } from "@/lib/agent-colors";

export interface StepRunner {
  botId: string;
  name: string;
  role: string | null;
}

interface StepRunnerLineProps {
  /** The agent that runs this step on this board; null when no agent matches the role. */
  runner: StepRunner | null;
  /** That agent's skill names, oldest first. Undefined while not known yet (or the load failed): no skills part is shown. */
  skillNames?: string[];
  /** False until role coverage has loaded (or when the board has no agents): no line at all. */
  coverageKnown: boolean;
}

/** "Runs here: (P) Planner · ⚡ skill-name" under a step on the Workflows tab. */
export function StepRunnerLine({ runner, skillNames, coverageKnown }: StepRunnerLineProps) {
  if (!coverageKnown) return null;

  if (!runner) {
    return <div className="mt-0.5 text-[11px] text-red-400">No agent on this board yet</div>;
  }

  const colors = getRoleColor(runner.role);
  return (
    <div className="mt-0.5 flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[11px] text-muted-foreground">
      <span>Runs here:</span>
      <span
        aria-hidden
        className={cn(
          "flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-[9px] font-semibold",
          colors.avatarBg,
          colors.avatarText
        )}
      >
        {getInitials(runner.name).slice(0, 1)}
      </span>
      <Link href={`/agents/${runner.botId}`} className="font-medium text-foreground hover:underline">
        {runner.name}
      </Link>
      {skillNames && (
        <>
          <span aria-hidden>&middot;</span>
          {skillNames.length > 0 ? (
            <span className="flex min-w-0 items-center gap-1">
              <span aria-hidden className="text-amber-400">&#9889;</span>
              <span className="min-w-0 break-all font-mono text-foreground">{skillNames.join(", ")}</span>
            </span>
          ) : (
            <span>no skills</span>
          )}
        </>
      )}
    </div>
  );
}
