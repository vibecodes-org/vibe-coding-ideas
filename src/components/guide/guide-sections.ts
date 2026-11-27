import {
  Bot,
  Cable,
  LayoutGrid,
  Lightbulb,
  MessageCircle,
  Package,
  Rocket,
  Settings,
  Shield,
  SquareTerminal,
  Users,
  Zap,
  type LucideIcon,
} from "lucide-react";
import { MCP_TOOL_COUNT } from "@/lib/site-facts";

export interface GuideSection {
  slug: string;
  title: string;
  icon: LucideIcon;
  description: string;
  iconClass: string;
  bgClass: string;
}

/** The guide's pages, in reading order. Drives the sidebar, home cards, Previous/Next and the sitemap. */
export const GUIDE_SECTIONS: readonly GuideSection[] = [
  {
    slug: "getting-started",
    title: "Getting Started",
    icon: Rocket,
    iconClass: "text-primary",
    bgClass: "bg-primary/10",
    description:
      "Sign up, type one line about your idea, and get a board with a team and workflows ready to go.",
  },
  {
    slug: "ideas-and-voting",
    title: "Ideas & Voting",
    icon: Lightbulb,
    iconClass: "text-amber-400",
    bgClass: "bg-amber-500/10",
    description:
      "Write up an idea or let AI draft it, choose who can see it, and gather votes and comments.",
  },
  {
    slug: "collaboration",
    title: "Collaboration",
    icon: Users,
    iconClass: "text-blue-400",
    bgClass: "bg-blue-500/10",
    description:
      "Bring people onto a project, @mention them, and choose which notifications you get.",
  },
  {
    slug: "discussions",
    title: "Discussions",
    icon: MessageCircle,
    iconClass: "text-violet-400",
    bgClass: "bg-violet-500/10",
    description:
      "Talk a feature through in a thread, then turn the outcome into cards on the board.",
  },
  {
    slug: "kanban-boards",
    title: "Kanban Boards",
    icon: LayoutGrid,
    iconClass: "text-blue-400",
    bgClass: "bg-blue-500/10",
    description:
      "Cards and columns, labels, due dates, files and filters. AI Generate Tasks fills an empty board for you.",
  },
  {
    slug: "project-kits",
    title: "Project Types",
    icon: Package,
    iconClass: "text-violet-400",
    bgClass: "bg-violet-500/10",
    description:
      "Pick what you're building (web app, mobile app, API, AI agent, game, or start from scratch) and your team and workflows turn up ready.",
  },
  {
    slug: "workflows",
    title: "Workflows",
    icon: Zap,
    iconClass: "text-amber-400",
    bgClass: "bg-amber-500/10",
    description:
      "The steps your agents follow on each card. Add or remove steps, add stops that wait for your OK, and use labels to start a workflow automatically.",
  },
  {
    slug: "mcp-integration",
    title: "MCP Integration",
    icon: Cable,
    iconClass: "text-cyan-400",
    bgClass: "bg-cyan-500/10",
    description:
      `The ${MCP_TOOL_COUNT} tools Claude Code or Codex uses to read and run your board: how to connect, and what each one does.`,
  },
  {
    slug: "launching-claude-code",
    title: "Launching Claude Code or Codex",
    icon: SquareTerminal,
    iconClass: "text-emerald-400",
    bgClass: "bg-emerald-500/10",
    description:
      "Hit Launch and an agent starts on your board, in a terminal docked under your cards or in a window on your computer.",
  },
  {
    slug: "ai-agent-teams",
    title: "AI Agent Teams",
    icon: Bot,
    iconClass: "text-emerald-400",
    bgClass: "bg-emerald-500/10",
    description:
      "Add agents from the library, copy ones other people have shared, or write your own. Plus AI credits and using your own key.",
  },
  {
    slug: "settings",
    title: "Settings",
    icon: Settings,
    iconClass: "text-cyan-400",
    bgClass: "bg-cyan-500/10",
    description:
      "Your profile, notifications, board defaults, AI key, model choices and connections, all in one place.",
  },
  {
    slug: "admin",
    title: "Admin",
    icon: Shield,
    iconClass: "text-violet-400",
    bgClass: "bg-violet-500/10",
    description:
      "For site admins: AI usage and costs, feedback, the agent and workflow libraries, and the cost report.",
  },
];
