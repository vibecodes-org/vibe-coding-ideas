"use client";

import { useEffect, useRef, useState } from "react";
import {
  Lightbulb,
  LayoutDashboard,
  Bot,
  Workflow,
  Link as LinkIcon,
  ChevronRight,
  RotateCcw,
} from "lucide-react";
import { cn } from "@/lib/utils";

const stages = [
  {
    icon: Lightbulb,
    title: "Ideas",
    description: "Describe your vision. AI refines it.",
    color: "amber",
  },
  {
    icon: LayoutDashboard,
    title: "Board",
    description: "AI generates tasks, labels, milestones.",
    color: "blue",
  },
  {
    icon: Bot,
    title: "Agents",
    description: "Named AI personas claim tasks.",
    color: "purple",
  },
  {
    icon: Workflow,
    title: "Workflows",
    description: "Multi-step pipelines with approvals.",
    color: "emerald",
  },
  {
    icon: LinkIcon,
    title: "MCP",
    description: "Claude Code orchestrates it all.",
    color: "cyan",
  },
];

const colorMap: Record<string, { icon: string; border: string; glow: string; bg: string }> = {
  amber: {
    icon: "text-amber-400",
    border: "border-amber-400/60",
    glow: "shadow-[0_0_30px_rgba(251,191,36,0.15)]",
    bg: "bg-amber-400/10",
  },
  blue: {
    icon: "text-blue-400",
    border: "border-blue-400/60",
    glow: "shadow-[0_0_30px_rgba(96,165,250,0.15)]",
    bg: "bg-blue-400/10",
  },
  purple: {
    icon: "text-purple-400",
    border: "border-purple-400/60",
    glow: "shadow-[0_0_30px_rgba(192,132,252,0.15)]",
    bg: "bg-purple-400/10",
  },
  emerald: {
    icon: "text-emerald-400",
    border: "border-emerald-400/60",
    glow: "shadow-[0_0_30px_rgba(52,211,153,0.15)]",
    bg: "bg-emerald-400/10",
  },
  cyan: {
    icon: "text-cyan-400",
    border: "border-cyan-400/60",
    glow: "shadow-[0_0_30px_rgba(34,211,238,0.15)]",
    bg: "bg-cyan-400/10",
  },
};

export function PipelineFlow({ className }: { className?: string }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [visibleStages, setVisibleStages] = useState<number[]>([]);
  const [activeStage, setActiveStage] = useState<number>(-1);
  const [hasPlayed, setHasPlayed] = useState(false);

  function animate() {
    setVisibleStages([]);
    setActiveStage(-1);

    stages.forEach((_, i) => {
      setTimeout(() => {
        setVisibleStages((prev) => [...prev, i]);
        setActiveStage(i);
      }, 200 + i * 400);
    });
  }

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && !hasPlayed) {
          setHasPlayed(true);
          setTimeout(animate, 300);
        }
      },
      { threshold: 0.3 }
    );

    observer.observe(el);
    return () => observer.disconnect();
  }, [hasPlayed]);

  function replay() {
    setHasPlayed(false);
    setTimeout(() => {
      setHasPlayed(true);
      animate();
    }, 50);
  }

  return (
    <div ref={containerRef} className={cn("flex flex-col items-center", className)}>
      <div className="flex w-full flex-col items-center gap-3 md:flex-row md:justify-center md:gap-0">
        {stages.map((stage, i) => {
          const colors = colorMap[stage.color];
          const isVisible = visibleStages.includes(i);
          const isActive = activeStage === i;
          const Icon = stage.icon;

          return (
            <div key={stage.title} className="flex items-center gap-0 md:flex-row flex-col">
              {/* Stage card */}
              <div
                className={cn(
                  "flex w-full max-w-[200px] flex-col items-center rounded-xl border bg-zinc-800/80 p-5 text-center transition-all duration-500",
                  isVisible
                    ? "translate-y-0 scale-100 opacity-100"
                    : "translate-y-4 scale-95 opacity-0",
                  isActive
                    ? cn(colors.border, colors.glow, "animate-pulse-subtle")
                    : "border-zinc-700/50"
                )}
              >
                <div
                  className={cn(
                    "mb-3 flex h-11 w-11 items-center justify-center rounded-[10px] transition-colors duration-400",
                    isActive ? colors.bg : "bg-zinc-700/50"
                  )}
                >
                  <Icon className={cn("h-[22px] w-[22px]", colors.icon)} />
                </div>
                <div className="text-[13px] font-bold tracking-tight">{stage.title}</div>
                <div className="mt-1 text-[11px] leading-snug text-zinc-400">
                  {stage.description}
                </div>
              </div>

              {/* Arrow between stages */}
              {i < stages.length - 1 && (
                <div
                  className={cn(
                    "flex items-center justify-center transition-opacity duration-300 md:w-10 h-7 md:h-auto rotate-90 md:rotate-0",
                    isVisible ? "opacity-100" : "opacity-0"
                  )}
                >
                  <ChevronRight
                    className={cn(
                      "h-5 w-5 transition-colors duration-300",
                      isActive ? "text-emerald-400" : "text-zinc-600"
                    )}
                  />
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Replay button */}
      <button
        onClick={replay}
        className="mt-6 inline-flex items-center gap-1.5 rounded-lg border border-zinc-700 bg-zinc-800 px-4 py-2 font-mono text-[11px] uppercase tracking-widest text-zinc-400 transition-all hover:border-emerald-400/50 hover:text-emerald-400"
      >
        <RotateCcw className="h-3.5 w-3.5" />
        Replay
      </button>
    </div>
  );
}
