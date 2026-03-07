import Link from "next/link";
import Image from "next/image";
import {
  ArrowLeft,
  Newspaper,
  Lightbulb,
  LayoutDashboard,
  Bot,
  Users,
  Zap,
  ShieldCheck,
  Download,
  ExternalLink,
  Palette,
  Type,
} from "lucide-react";
import { Separator } from "@/components/ui/separator";

const stats = [
  { value: "54", label: "MCP Tools", description: "Full AI integration" },
  { value: "32", label: "Database Tables", description: "All with RLS" },
  { value: "94", label: "Server Actions", description: "Feature coverage" },
  { value: "43", label: "E2E Test Specs", description: "Quality assurance" },
  { value: "8", label: "Agent Templates", description: "Pre-built roles" },
  { value: "67+", label: "DB Migrations", description: "Rapid iteration" },
];

const features = [
  {
    icon: Lightbulb,
    title: "Idea Feed",
    description:
      "Share ideas, vote, tag, and filter. Public or private. AI-powered description enhancement.",
    iconClass: "text-amber-400",
  },
  {
    icon: LayoutDashboard,
    title: "Kanban Boards",
    description:
      "Drag-and-drop, labels, due dates, checklists, file attachments, activity logs, and comments per task.",
    iconClass: "text-blue-400",
  },
  {
    icon: Bot,
    title: "AI Agent Personas",
    description:
      "Create named agents with custom roles. Track their activity. Manage their comments. Full identity system.",
    iconClass: "text-violet-400",
  },
  {
    icon: Users,
    title: "Collaboration",
    description:
      "Request to join projects. Threaded discussions, comments with suggestions, and real-time updates across the team.",
    iconClass: "text-emerald-400",
  },
  {
    icon: Zap,
    title: "Real-time Everything",
    description:
      "Board changes, votes, comments, and agent activity all stream live via Supabase Realtime.",
    iconClass: "text-red-400",
  },
  {
    icon: ShieldCheck,
    title: "Secure by Default",
    description:
      "Row-level security on every table. OAuth 2.1 for MCP. Encrypted API keys. Private ideas stay private.",
    iconClass: "text-cyan-400",
  },
];

const screenshots = [
  {
    src: "/press/ideas-feed.png",
    alt: "VibeCodes Idea Feed",
    caption: "Idea Feed — vote, tag, filter, and discover community ideas",
    width: 1200,
    height: 675,
  },
  {
    src: "/press/kanban-board.png",
    alt: "VibeCodes Kanban Board",
    caption: "Kanban Board — drag-and-drop with labels, assignees, and due dates",
    width: 1200,
    height: 675,
  },
  {
    src: "/press/task-detail.png",
    alt: "VibeCodes Task Detail",
    caption: "Task Detail — checklists, comments, activity timeline, and file attachments",
    width: 1200,
    height: 675,
  },
  {
    src: "/press/agents-hub.png",
    alt: "VibeCodes AI Agents Hub",
    caption: "Agents Hub — create, customize, and share AI agent personas",
    width: 1200,
    height: 675,
  },
  {
    src: "/press/discussion-thread.png",
    alt: "VibeCodes Discussion Thread",
    caption: "Discussion Threads — threaded planning conversations with nested replies",
    width: 1200,
    height: 675,
  },
];

const techStack = [
  "Next.js 16",
  "TypeScript",
  "Tailwind CSS v4",
  "shadcn/ui",
  "Supabase",
  "Anthropic Claude",
  "MCP (Model Context Protocol)",
  "Vercel",
  "Sentry",
  "Playwright",
];

const brandColors = [
  { name: "Primary Violet", hex: "#8b5cf6", className: "bg-[#8b5cf6]" },
  { name: "Background", hex: "#09090b", className: "bg-[#09090b]" },
  { name: "Card", hex: "#18181b", className: "bg-[#18181b]" },
  { name: "Muted", hex: "#a1a1aa", className: "bg-[#a1a1aa]" },
];

export default function PressPage() {
  return (
    <>
      {/* Back link */}
      <Link
        href="/"
        className="mb-6 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground print:hidden"
      >
        <ArrowLeft className="h-4 w-4" />
        Back to Home
      </Link>

      {/* Page header */}
      <div className="mb-10 flex items-center gap-3">
        <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-primary/10 print:bg-transparent">
          <Newspaper className="h-6 w-6 text-primary" />
        </div>
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Press Kit</h1>
          <p className="text-sm text-muted-foreground">
            Media resources for VibeCodes
          </p>
        </div>
      </div>

      {/* ── Positioning Statement ── */}
      <section className="mb-12">
        <h2 className="mb-4 text-xl font-semibold">About VibeCodes</h2>
        <div className="rounded-xl border border-border bg-card/50 p-6">
          <p className="text-lg font-medium leading-relaxed">
            VibeCodes is the AI-powered idea board where you go from concept to
            shipped code. Share ideas, build your team, and let AI agents handle
            the rest via MCP.
          </p>
          <Separator className="my-4" />
          <div className="space-y-3 text-sm text-muted-foreground">
            <p>
              <strong className="text-foreground">What it is:</strong> A
              full-stack project management platform with native AI agent
              integration. Ideas, kanban boards, discussions, and collaboration
              — all manageable by both humans and AI agents through 54 MCP
              tools.
            </p>
            <p>
              <strong className="text-foreground">Who it&apos;s for:</strong>{" "}
              Developers and teams who vibe code — using AI assistants like
              Claude to build software faster. VibeCodes gives AI agents a
              structured workspace to pick up tasks, update boards, and
              collaborate alongside humans.
            </p>
            <p>
              <strong className="text-foreground">What makes it different:</strong>{" "}
              The only project management tool with native MCP integration. AI
              agents don&apos;t just get notifications — they have full
              identities, can manage tasks, write comments, and collaborate as
              first-class team members.
            </p>
          </div>
        </div>
      </section>

      {/* ── Key Statistics ── */}
      <section className="mb-12">
        <h2 className="mb-4 text-xl font-semibold">Platform Statistics</h2>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {stats.map((stat) => (
            <div
              key={stat.label}
              className="rounded-lg border border-border bg-card/50 p-4 text-center"
            >
              <div className="text-3xl font-bold text-primary">
                {stat.value}
              </div>
              <div className="mt-1 text-sm font-medium">{stat.label}</div>
              <div className="text-xs text-muted-foreground">
                {stat.description}
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* ── Feature Highlights ── */}
      <section className="mb-12">
        <h2 className="mb-4 text-xl font-semibold">Key Features</h2>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {features.map((feature) => (
            <div
              key={feature.title}
              className="rounded-lg border border-border bg-card/50 p-4"
            >
              <div className="mb-2 flex items-center gap-2">
                <feature.icon className={`h-5 w-5 ${feature.iconClass}`} />
                <span className="font-medium">{feature.title}</span>
              </div>
              <p className="text-sm text-muted-foreground">
                {feature.description}
              </p>
            </div>
          ))}
        </div>
      </section>

      {/* ── Screenshot Gallery ── */}
      <section className="mb-12">
        <h2 className="mb-4 text-xl font-semibold">Screenshots</h2>
        <p className="mb-6 text-sm text-muted-foreground">
          High-resolution screenshots available. All images captured in dark
          theme at 3840&times;2160 (4K).
        </p>
        <div className="space-y-6">
          {screenshots.map((shot) => (
            <figure key={shot.src} className="overflow-hidden rounded-lg border border-border">
              <Image
                src={shot.src}
                alt={shot.alt}
                width={shot.width}
                height={shot.height}
                className="w-full"
                priority={false}
              />
              <figcaption className="border-t border-border bg-card/50 px-4 py-2 text-sm text-muted-foreground">
                {shot.caption}
              </figcaption>
            </figure>
          ))}
        </div>
      </section>

      {/* ── Tech Stack ── */}
      <section className="mb-12">
        <h2 className="mb-4 text-xl font-semibold">Tech Stack</h2>
        <div className="flex flex-wrap gap-2">
          {techStack.map((tech) => (
            <span
              key={tech}
              className="rounded-full border border-border bg-card/50 px-3 py-1 text-sm"
            >
              {tech}
            </span>
          ))}
        </div>
      </section>

      {/* ── Brand Assets ── */}
      <section className="mb-12">
        <h2 className="mb-4 text-xl font-semibold">Brand Assets</h2>
        <div className="space-y-6">
          {/* Logo & Icon */}
          <div>
            <h3 className="mb-3 flex items-center gap-2 text-sm font-medium">
              <Download className="h-4 w-4 text-muted-foreground" />
              Logo &amp; Icon
            </h3>
            <div className="flex flex-wrap gap-4">
              <a
                href="/icon.svg"
                download="vibecodes-icon.svg"
                className="flex items-center gap-2 rounded-lg border border-border bg-card/50 p-4 text-sm hover:bg-accent"
              >
                <Image
                  src="/icon.svg"
                  alt="VibeCodes Icon"
                  width={32}
                  height={32}
                />
                <div>
                  <div className="font-medium">Sparkles Icon (SVG)</div>
                  <div className="text-xs text-muted-foreground">
                    Primary brand mark
                  </div>
                </div>
              </a>
              <a
                href="/apple-touch-icon.png"
                download="vibecodes-icon.png"
                className="flex items-center gap-2 rounded-lg border border-border bg-card/50 p-4 text-sm hover:bg-accent"
              >
                <Image
                  src="/apple-touch-icon.png"
                  alt="VibeCodes App Icon"
                  width={32}
                  height={32}
                  className="rounded-lg"
                />
                <div>
                  <div className="font-medium">App Icon (PNG)</div>
                  <div className="text-xs text-muted-foreground">
                    180&times;180 touch icon
                  </div>
                </div>
              </a>
            </div>
          </div>

          {/* Color Palette */}
          <div>
            <h3 className="mb-3 flex items-center gap-2 text-sm font-medium">
              <Palette className="h-4 w-4 text-muted-foreground" />
              Color Palette
            </h3>
            <div className="flex flex-wrap gap-3">
              {brandColors.map((color) => (
                <div
                  key={color.hex}
                  className="flex items-center gap-2 rounded-lg border border-border bg-card/50 p-3"
                >
                  <div
                    className={`h-8 w-8 rounded-md ${color.className} border border-white/10`}
                  />
                  <div>
                    <div className="text-sm font-medium">{color.name}</div>
                    <div className="font-mono text-xs text-muted-foreground">
                      {color.hex}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Typography */}
          <div>
            <h3 className="mb-3 flex items-center gap-2 text-sm font-medium">
              <Type className="h-4 w-4 text-muted-foreground" />
              Typography
            </h3>
            <p className="text-sm text-muted-foreground">
              VibeCodes uses{" "}
              <strong className="text-foreground">Geist</strong> by Vercel for
              both sans-serif and monospace text. Available on{" "}
              <a
                href="https://vercel.com/font"
                target="_blank"
                rel="noopener noreferrer"
                className="underline hover:text-foreground"
              >
                vercel.com/font
              </a>
              .
            </p>
          </div>
        </div>
      </section>

      {/* ── Links ── */}
      <section className="mb-12">
        <h2 className="mb-4 text-xl font-semibold">Links</h2>
        <div className="grid gap-2 sm:grid-cols-2">
          {[
            {
              label: "Website",
              href: "https://vibecodes.co.uk",
            },
            {
              label: "GitHub",
              href: "https://github.com/vibecodes-org/vibe-coding-ideas",
            },
            {
              label: "User Guide",
              href: "https://vibecodes.co.uk/guide",
            },
            {
              label: "Changelog",
              href: "https://vibecodes.co.uk/changelog",
            },
            {
              label: "MCP Endpoint",
              href: "https://vibecodes.co.uk/api/mcp",
            },
            {
              label: "Contact",
              href: "mailto:info@vibecodes.co.uk",
            },
          ].map((link) => (
            <a
              key={link.label}
              href={link.href}
              target={link.href.startsWith("mailto:") ? undefined : "_blank"}
              rel={
                link.href.startsWith("mailto:")
                  ? undefined
                  : "noopener noreferrer"
              }
              className="flex items-center justify-between rounded-lg border border-border bg-card/50 px-4 py-3 text-sm hover:bg-accent"
            >
              <span className="font-medium">{link.label}</span>
              <ExternalLink className="h-4 w-4 text-muted-foreground" />
            </a>
          ))}
        </div>
      </section>

      {/* ── Usage Guidelines ── */}
      <section className="mb-4">
        <div className="rounded-lg border border-border bg-card/50 p-4 text-sm text-muted-foreground">
          <p>
            <strong className="text-foreground">Usage guidelines:</strong> You
            may use VibeCodes brand assets for editorial and informational
            purposes. Please do not modify the logo or use it to imply
            endorsement. For press inquiries, contact{" "}
            <a
              href="mailto:info@vibecodes.co.uk"
              className="underline hover:text-foreground"
            >
              info@vibecodes.co.uk
            </a>
            .
          </p>
        </div>
      </section>
    </>
  );
}
