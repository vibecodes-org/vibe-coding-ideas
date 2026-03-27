"use client";

import { Bot, Check } from "lucide-react";

/**
 * CSS-only micro-animation showing an agent picking up and completing a task.
 * Horizontal flow: To Do → Agent → Done, 5-second seamless loop.
 * Falls back to static Bot icon when prefers-reduced-motion is set.
 */
export function AgentAnimation({ className }: { className?: string }) {
  return (
    <div
      className={`agent-anim relative h-[72px] w-[220px] ${className ?? ""}`}
      aria-hidden="true"
    >
      {/* Track line */}
      <div className="absolute left-6 right-6 top-1/2 h-0.5 -translate-y-px bg-zinc-700">
        <div className="agent-anim-track h-full w-0 rounded-sm bg-emerald-500" />
      </div>

      {/* Start dot */}
      <div className="agent-anim-dot-start absolute left-6 top-1/2 h-2 w-2 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-zinc-700 bg-zinc-900" />

      {/* End dot */}
      <div className="agent-anim-dot-end absolute right-6 top-1/2 h-2 w-2 translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-zinc-700 bg-zinc-900" />

      {/* Labels */}
      <span className="absolute left-2.5 top-0.5 text-[9px] font-semibold uppercase tracking-wide text-zinc-600">
        To Do
      </span>
      <span className="absolute right-2.5 top-0.5 text-[9px] font-semibold uppercase tracking-wide text-zinc-600">
        Done
      </span>

      {/* Task card */}
      <div className="agent-anim-task absolute left-6 top-1/2 z-[3] flex h-7 w-9 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-[5px] border-[1.5px] border-zinc-600 bg-zinc-800">
        <div className="flex flex-col gap-[3px] p-0.5">
          <div className="h-0.5 w-[18px] rounded-sm bg-zinc-400" />
          <div className="h-0.5 w-3 rounded-sm bg-zinc-600" />
        </div>
      </div>

      {/* Agent avatar */}
      <div className="agent-anim-agent absolute left-1/2 top-1/2 z-[4] flex h-8 w-8 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border-[1.5px] border-emerald-500/30 bg-emerald-500/10">
        <Bot className="h-4 w-4 text-emerald-400" />
      </div>

      {/* Checkmark */}
      <div className="agent-anim-check absolute right-6 top-1/2 z-[5] flex h-5 w-5 translate-x-1/2 -translate-y-1/2 scale-0 items-center justify-center rounded-full bg-emerald-500">
        <Check className="h-3 w-3 text-white" strokeWidth={2.5} />
      </div>
    </div>
  );
}
