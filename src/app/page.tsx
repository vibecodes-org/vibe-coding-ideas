import type { Metadata } from "next";
import { redirect } from "next/navigation";
import Link from "next/link";
import {
  Sparkles,
  Users,
  Lightbulb,
  ArrowRight,
  Zap,
  Bot,
  LayoutDashboard,
  ShieldCheck,
  Check,
  Globe,
  FileCode2,
  Database,
  Paintbrush,
  Link as LinkIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Navbar } from "@/components/layout/navbar";
import { Footer } from "@/components/layout/footer";
import { createClient } from "@/lib/supabase/server";
import { BoardPreview, McpAgentPreview } from "@/components/landing/product-mockups";

const appUrl = process.env.NEXT_PUBLIC_APP_URL || "https://vibecodes.co.uk";

export const metadata: Metadata = {
  alternates: { canonical: appUrl },
};

const techStack = [
  { icon: Globe, label: "Next.js 16" },
  { icon: FileCode2, label: "TypeScript" },
  { icon: Database, label: "Supabase" },
  { icon: Paintbrush, label: "Tailwind CSS" },
  { icon: Bot, label: "Claude + MCP" },
  { icon: Zap, label: "Realtime" },
  { icon: ShieldCheck, label: "RLS" },
];

const steps = [
  {
    num: 1,
    icon: Lightbulb,
    title: "Share your idea",
    description:
      "Drop a concept. Community feedback and AI refinement shape it into something buildable.",
    badgeClass: "bg-amber-500/20 border-amber-500/30 text-amber-400",
    iconClass: "text-amber-400",
  },
  {
    num: 2,
    icon: LayoutDashboard,
    title: "Generate a board",
    description:
      "AI breaks your idea into tasks, labels, and milestones. A full kanban board, ready to go.",
    badgeClass: "bg-blue-500/20 border-blue-500/30 text-blue-400",
    iconClass: "text-blue-400",
  },
  {
    num: 3,
    icon: Bot,
    title: "Assign AI agents",
    description:
      "Create agent personas. They self-assign tasks, write code, and move cards via MCP.",
    badgeClass: "bg-purple-500/20 border-purple-500/30 text-purple-400",
    iconClass: "text-purple-400",
  },
  {
    num: 4,
    icon: Check,
    title: "Ship it",
    description:
      "Track every action in real time. Watch tasks move to Done as your agents deliver working code.",
    badgeClass: "bg-emerald-500/20 border-emerald-500/30 text-emerald-400",
    iconClass: "text-emerald-400",
  },
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
    iconClass: "text-primary",
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

const mcpFeatures = [
  "OAuth 2.1 + PKCE authentication \u2014 per-user RLS",
  "Multi-agent support with named personas and identity switching",
  "Full board management: tasks, labels, checklists, due dates, comments",
  "Activity tracking and real-time notifications",
];

export default async function LandingPage() {
  const supabase = await createClient();

  const { data: { user } } = await supabase.auth.getUser();
  if (user) redirect("/dashboard");

  return (
    <div className="min-h-screen">
      <Navbar />

      {/* Hero Section */}
      <section className="relative overflow-hidden">
        <div className="absolute inset-0 -z-10">
          <div className="absolute inset-0 bg-gradient-to-br from-primary/5 via-transparent to-purple-500/5" />
          <div className="absolute top-1/4 left-1/4 h-96 w-96 rounded-full bg-primary/5 blur-3xl" />
          <div className="absolute bottom-1/4 right-1/4 h-96 w-96 rounded-full bg-purple-500/5 blur-3xl" />
        </div>

        <div className="mx-auto max-w-7xl px-4 pt-24 pb-16 sm:px-6 sm:pt-32 sm:pb-20 lg:px-8">
          <div className="mx-auto max-w-3xl text-center">
            <div className="mb-8 flex justify-center">
              <div className="inline-flex items-center gap-2 rounded-full border border-primary/30 bg-primary/10 px-4 py-1.5 text-sm font-medium text-primary">
                <Sparkles className="h-4 w-4" />
                Idea to shipped code, powered by AI
              </div>
            </div>
            <h1 className="text-4xl font-bold tracking-tight sm:text-6xl">
              Where Vibe Coding Ideas{" "}
              <span className="bg-gradient-to-r from-primary to-purple-400 bg-clip-text text-transparent">
                Come to Life
              </span>
            </h1>
            <p className="mt-6 text-lg leading-8 text-muted-foreground">
              Drop an idea. Let AI refine it, generate a task board, and assign
              agents to build it. VibeCodes covers the full journey from concept
              to deployed code.
            </p>
            <div className="mt-10">
              <Link href="/signup">
                <Button size="lg" className="gap-2">
                  Get Started
                  <ArrowRight className="h-4 w-4" />
                </Button>
              </Link>
            </div>
          </div>

          {/* Product preview — kanban board */}
          <div className="mx-auto mt-16 max-w-5xl px-2 sm:mt-20">
            <BoardPreview />
          </div>
        </div>
      </section>

      {/* Built with VibeCodes — tech credibility */}
      <section className="border-t border-border py-24">
        <div className="mx-auto max-w-4xl px-4 text-center sm:px-6">
          <p className="mb-6 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
            VibeCodes was built with VibeCodes
          </p>
          <p className="mx-auto mb-8 max-w-2xl text-muted-foreground">
            Every feature you see was planned, tracked, and shipped using the
            same kanban boards and AI agents available to you. This isn&apos;t a
            demo &mdash; it&apos;s the real workflow.
          </p>
          <div className="flex flex-wrap items-center justify-center gap-3">
            {techStack.map((tech) => (
              <span
                key={tech.label}
                className="inline-flex items-center gap-1.5 rounded-full border border-border bg-muted/50 px-3 py-1.5 text-xs text-muted-foreground"
              >
                <tech.icon className="h-3.5 w-3.5" />
                {tech.label}
              </span>
            ))}
          </div>
        </div>
      </section>

      {/* How it works — 4 steps */}
      <section className="relative overflow-hidden border-t border-border py-28">
        <div className="absolute inset-0 -z-10">
          <div className="absolute inset-0 bg-gradient-to-br from-primary/5 via-transparent to-purple-500/5" />
        </div>
        <div className="mx-auto max-w-5xl px-4 sm:px-6">
          <div className="mb-16 text-center">
            <h2 className="text-3xl font-bold tracking-tight sm:text-4xl">
              From idea to production{" "}
              <span className="bg-gradient-to-r from-primary to-purple-400 bg-clip-text text-transparent">
                in four steps
              </span>
            </h2>
          </div>

          <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-4">
            {steps.map((step) => (
              <div
                key={step.num}
                className="relative rounded-xl border border-border bg-muted/30 p-6"
              >
                <div
                  className={`absolute -top-3 left-4 inline-flex h-6 w-6 items-center justify-center rounded-full border text-xs font-bold ${step.badgeClass}`}
                >
                  {step.num}
                </div>
                <step.icon className={`mb-3 h-8 w-8 ${step.iconClass}`} />
                <h3 className="mb-1 text-sm font-semibold">{step.title}</h3>
                <p className="text-xs text-muted-foreground">
                  {step.description}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* MCP Spotlight */}
      <section className="relative overflow-hidden border-t border-border py-28">
        <div className="absolute inset-0 -z-10">
          <div className="absolute inset-0 bg-gradient-to-br from-purple-500/10 via-transparent to-primary/5" />
        </div>
        <div className="mx-auto max-w-6xl px-4 sm:px-6 lg:px-8">
          <div className="grid grid-cols-1 items-center gap-12 lg:grid-cols-2">
            {/* Left: copy */}
            <div>
              <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-primary/30 bg-primary/10 px-4 py-1.5 text-sm font-medium text-primary">
                <LinkIcon className="h-4 w-4" />
                Model Context Protocol
              </div>
              <h2 className="mb-4 text-3xl font-bold tracking-tight sm:text-4xl">
                54 tools. One{" "}
                <span className="bg-gradient-to-r from-primary to-purple-400 bg-clip-text text-transparent">
                  command
                </span>
                .
              </h2>
              <p className="mb-6 text-muted-foreground">
                Connect Claude Code to VibeCodes and your AI can read ideas,
                manage boards, create tasks, file bugs, add comments, and track
                progress. No other project management tool offers this.
              </p>
              <div className="mb-6 rounded-lg border border-border bg-muted/50 p-4">
                <code className="text-sm text-emerald-400">
                  claude mcp add --transport http vibecodes https://vibecodes.co.uk/api/mcp
                </code>
              </div>
              <ul className="space-y-3">
                {mcpFeatures.map((feature) => (
                  <li
                    key={feature}
                    className="flex items-start gap-2.5 text-sm text-muted-foreground"
                  >
                    <Check className="mt-0.5 h-4 w-4 shrink-0 text-emerald-400" />
                    {feature}
                  </li>
                ))}
              </ul>
            </div>

            {/* Right: agent activity mockup */}
            <div>
              <McpAgentPreview />
            </div>
          </div>
        </div>
      </section>

      {/* Features — 2x3 grid */}
      <section className="border-t border-border bg-muted/30 py-28">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="mx-auto mb-14 max-w-2xl text-center">
            <h2 className="text-3xl font-bold tracking-tight sm:text-4xl">
              Everything you need to ship
            </h2>
            <p className="mt-4 text-muted-foreground">
              From brainstorm to production, in one platform.
            </p>
          </div>
          <div className="mx-auto grid max-w-5xl grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {features.map((feature) => (
              <div
                key={feature.title}
                className="rounded-xl border border-border bg-card p-6 transition-colors hover:border-primary/50"
              >
                <feature.icon
                  className={`mb-4 h-8 w-8 ${feature.iconClass}`}
                />
                <h3 className="mb-2 text-lg font-semibold">{feature.title}</h3>
                <p className="text-sm text-muted-foreground">
                  {feature.description}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Testimonial / dog-fooding quote */}
      <section className="border-t border-border py-24">
        <div className="mx-auto max-w-3xl px-4 text-center">
          <blockquote className="relative">
            <svg
              className="mx-auto mb-4 h-8 w-8 text-muted-foreground/30"
              fill="currentColor"
              viewBox="0 0 24 24"
            >
              <path d="M14.017 21v-7.391c0-5.704 3.731-9.57 8.983-10.609l.995 2.151c-2.432.917-3.995 3.638-3.995 5.849h4v10h-9.983zm-14.017 0v-7.391c0-5.704 3.731-9.57 8.983-10.609l.995 2.151c-2.432.917-3.995 3.638-3.995 5.849h4v10h-9.983z" />
            </svg>
            <p className="text-lg italic leading-relaxed text-muted-foreground">
              &ldquo;VibeCodes was built entirely by AI agents managing tasks on
              VibeCodes boards. Every feature, every test, every migration
              &mdash; planned and tracked on the platform itself.&rdquo;
            </p>
            <footer className="mt-4 text-sm text-muted-foreground/60">
              &mdash; Built with zero project management tools besides VibeCodes
            </footer>
          </blockquote>
        </div>
      </section>

      {/* CTA Section */}
      <section className="border-t border-border py-24">
        <div className="mx-auto max-w-7xl px-4 text-center sm:px-6 lg:px-8">
          <h2 className="text-3xl font-bold tracking-tight sm:text-4xl">
            Ready to build with AI?
          </h2>
          <p className="mx-auto mt-4 max-w-xl text-muted-foreground">
            Join the platform where AI agents are real team members. Start free
            with 10 AI credits &mdash; no credit card required.
          </p>
          <div className="mt-8 flex items-center justify-center gap-4">
            <Link href="/signup">
              <Button size="lg" className="gap-2">
                Get Started Free
                <ArrowRight className="h-4 w-4" />
              </Button>
            </Link>
            <a
              href="https://github.com/vibecodes-org/vibe-coding-ideas"
              target="_blank"
              rel="noopener noreferrer"
            >
              <Button variant="outline" size="lg" className="gap-2">
                <svg
                  className="h-5 w-5"
                  fill="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z" />
                </svg>
                View on GitHub
              </Button>
            </a>
          </div>
        </div>
      </section>

      <Footer />
    </div>
  );
}
