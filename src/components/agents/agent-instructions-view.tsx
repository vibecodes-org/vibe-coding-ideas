import { Eye } from "lucide-react";
import { parseInstructions } from "@/lib/agent-instructions";
import { normalizeToolAccess, type ToolAccess } from "@/lib/agent-tool-access";

interface AgentInstructionsViewProps {
  systemPrompt: string | null;
  role?: string | null;
}

/** Read-only badge shown next to the role. */
export function ReadOnlyBadge({ toolAccess }: { toolAccess: ToolAccess | string | null | undefined }) {
  if (normalizeToolAccess(toolAccess) !== "read_only") return null;
  return (
    <span className="inline-flex items-center gap-1 rounded-md border border-blue-500/25 bg-blue-500/10 px-2 py-0.5 text-[11px] font-medium text-blue-300">
      <Eye className="h-3 w-3" aria-hidden="true" />
      Read-only
    </span>
  );
}

function Card({ title, color, children }: { title: string; color: string; children: React.ReactNode }) {
  return (
    <div className="overflow-hidden rounded-lg border border-border bg-muted/30">
      <div className={`flex items-center gap-2 border-b border-border/50 px-3.5 py-2.5 text-xs font-semibold ${color}`}>
        {title}
      </div>
      <div className="whitespace-pre-wrap px-3.5 py-3 text-xs leading-relaxed text-muted-foreground">{children}</div>
    </div>
  );
}

/**
 * The agent's instructions in the four parts (plus any leftover old Expertise).
 * Text that fits neither layout keeps today's plain block.
 */
export function AgentInstructionsView({ systemPrompt, role }: AgentInstructionsViewProps) {
  if (!systemPrompt?.trim()) return null;
  const parsed = parseInstructions(systemPrompt, role);

  return (
    <div className="space-y-3">
      <h2 className="flex items-center gap-2 text-sm font-semibold">&#x1F9E0;&nbsp;Instructions</h2>
      {parsed ? (
        <div className="flex flex-col gap-3">
          {parsed.fields.oneLine && (
            <Card title="&#x1F3AF;&nbsp;In one line" color="text-emerald-500">
              {parsed.fields.oneLine}
            </Card>
          )}
          {parsed.fields.job && (
            <Card title="&#x1F4CB;&nbsp;Its job" color="text-violet-400">
              {parsed.fields.job}
            </Card>
          )}
          {(parsed.fields.handBack || parsed.fields.mustNot) && (
            <div className={`grid gap-3 ${parsed.fields.handBack && parsed.fields.mustNot ? "sm:grid-cols-2" : ""}`}>
              {parsed.fields.handBack && (
                <Card title="&#x1F4E4;&nbsp;Hands back" color="text-blue-400">
                  {parsed.fields.handBack}
                </Card>
              )}
              {parsed.fields.mustNot && (
                <Card title="&#x1F6AB;&nbsp;Must not do" color="text-red-500">
                  {parsed.fields.mustNot}
                </Card>
              )}
            </div>
          )}
          {parsed.fields.leftover && (
            <Card title="&#x1F4DD;&nbsp;Notes from the old format" color="text-amber-400">
              {parsed.fields.leftover}
            </Card>
          )}
        </div>
      ) : (
        <div className="rounded-lg border border-border bg-muted/30 p-4">
          <p className="whitespace-pre-wrap text-xs leading-relaxed text-muted-foreground">{systemPrompt}</p>
        </div>
      )}
    </div>
  );
}
