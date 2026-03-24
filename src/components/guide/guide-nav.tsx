"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Rocket,
  Lightbulb,
  Users,
  MessageCircle,
  LayoutGrid,
  Cable,
  Zap,
  Bot,
  Shield,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
import { cn } from "@/lib/utils";

const GUIDE_SECTIONS = [
  { slug: "getting-started", title: "Getting Started", icon: Rocket },
  { slug: "ideas-and-voting", title: "Ideas & Voting", icon: Lightbulb },
  { slug: "collaboration", title: "Collaboration", icon: Users },
  { slug: "discussions", title: "Discussions", icon: MessageCircle },
  { slug: "kanban-boards", title: "Kanban Boards", icon: LayoutGrid },
  { slug: "mcp-integration", title: "MCP Integration", icon: Cable },
  { slug: "workflows", title: "Workflows", icon: Zap },
  { slug: "ai-agent-teams", title: "AI Agent Teams", icon: Bot },
  { slug: "admin", title: "Admin", icon: Shield },
] as const;

function getCurrentSection(pathname: string) {
  const slug = pathname.replace("/guide/", "").replace("/guide", "");
  return GUIDE_SECTIONS.find((s) => s.slug === slug) ?? null;
}

function getCurrentIndex(pathname: string) {
  const slug = pathname.replace("/guide/", "").replace("/guide", "");
  return GUIDE_SECTIONS.findIndex((s) => s.slug === slug);
}

/** Desktop sidebar */
export function GuideSidebar() {
  const pathname = usePathname();

  // Don't show sidebar on the hub page
  if (pathname === "/guide") return null;

  return (
    <nav className="hidden w-52 shrink-0 lg:block" aria-label="Guide navigation">
      <div className="sticky top-20 space-y-0.5">
        {GUIDE_SECTIONS.map((section) => {
          const isActive = pathname === `/guide/${section.slug}`;
          const Icon = section.icon;
          return (
            <Link
              key={section.slug}
              href={`/guide/${section.slug}`}
              className={cn(
                "flex items-center gap-2 rounded-md px-3 py-2 text-sm transition-colors",
                isActive
                  ? "bg-violet-500/10 font-medium text-violet-400"
                  : "text-muted-foreground hover:bg-muted/50 hover:text-foreground"
              )}
            >
              <Icon className="h-4 w-4 shrink-0" />
              {section.title}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}

/** Mobile horizontal scroll nav */
export function GuideMobileNav() {
  const pathname = usePathname();

  // Don't show on the hub page
  if (pathname === "/guide") return null;

  return (
    <nav
      className="mb-6 -mx-4 overflow-x-auto border-b border-border px-4 pb-3 lg:hidden"
      aria-label="Guide navigation"
    >
      <div className="flex gap-1 whitespace-nowrap">
        {GUIDE_SECTIONS.map((section) => {
          const isActive = pathname === `/guide/${section.slug}`;
          const Icon = section.icon;
          return (
            <Link
              key={section.slug}
              href={`/guide/${section.slug}`}
              className={cn(
                "flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors",
                isActive
                  ? "bg-violet-500/10 text-violet-400"
                  : "text-muted-foreground hover:bg-muted/50 hover:text-foreground"
              )}
            >
              <Icon className="h-3.5 w-3.5 shrink-0" />
              {section.title}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}

/** Breadcrumbs */
export function GuideBreadcrumbs() {
  const pathname = usePathname();
  const current = getCurrentSection(pathname);

  // Don't show on the hub page
  if (!current || pathname === "/guide") return null;

  return (
    <div className="mb-4 text-sm text-muted-foreground">
      <Link href="/guide" className="hover:text-foreground transition-colors">
        Guide
      </Link>
      <span className="mx-1.5">/</span>
      <span className="text-foreground">{current.title}</span>
    </div>
  );
}

/** Previous / Next navigation */
export function GuidePrevNext() {
  const pathname = usePathname();
  const index = getCurrentIndex(pathname);

  // Don't show on the hub page or if not found
  if (index < 0 || pathname === "/guide") return null;

  const prev = index > 0 ? GUIDE_SECTIONS[index - 1] : null;
  const next = index < GUIDE_SECTIONS.length - 1 ? GUIDE_SECTIONS[index + 1] : null;

  if (!prev && !next) return null;

  return (
    <div className="mt-12 flex items-center justify-between border-t border-border pt-6">
      {prev ? (
        <Link
          href={`/guide/${prev.slug}`}
          className="flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
        >
          <ChevronLeft className="h-4 w-4" />
          <span>
            <span className="text-xs text-muted-foreground/60">Previous</span>
            <br />
            {prev.title}
          </span>
        </Link>
      ) : (
        <div />
      )}
      {next ? (
        <Link
          href={`/guide/${next.slug}`}
          className="flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground text-right"
        >
          <span>
            <span className="text-xs text-muted-foreground/60">Next</span>
            <br />
            {next.title}
          </span>
          <ChevronRight className="h-4 w-4" />
        </Link>
      ) : (
        <div />
      )}
    </div>
  );
}
