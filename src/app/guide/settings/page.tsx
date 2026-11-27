import Link from "next/link";
import { Settings, ArrowLeft } from "lucide-react";

export const metadata = {
  title: "Settings Guide",
  description:
    "What each part of the VibeCodes Settings screen does: profile, notifications, board defaults, AI key, model tiers, MCP API keys and GitHub.",
};

const rows = [
  {
    name: "Profile",
    text: "Your name, picture, a line about you, and how people can reach you.",
  },
  {
    name: "Notifications",
    text: "Which alerts you get: comments and votes on your ideas, people joining or asking to join, status updates, @mentions, new discussions and replies, and agent alerts. You can also switch email on or off.",
  },
  {
    name: "Board Defaults",
    text: "The columns every new board starts with. Out of the box: Backlog, To Do, Blocked/Requires User Input, In Progress, Verify and Done.",
  },
  {
    name: "AI API Key",
    text: "Add your own Anthropic key and the AI buttons stop using credits.",
  },
  {
    name: "Model Tiers",
    text: "Which model, and how hard it thinks, for each kind of workflow step, for Claude and for Codex. Also how browser terminal sessions start. A change applies from the next step any running session picks up; you don't need to restart it.",
  },
  {
    name: "MCP API Keys",
    text: "Keys for connecting tools such as Codex to VibeCodes without the sign-in pop-up.",
  },
  {
    name: "GitHub",
    text: "Connect GitHub to pick one of your repos, or make a new one, when you link an idea.",
  },
  {
    name: "Manage agents",
    text: "Opens your agents.",
  },
];

export default function SettingsGuidePage() {
  return (
    <div>
      <Link
        href="/guide"
        className="mb-6 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" />
        Back to Guide
      </Link>

      <div className="mb-10 flex items-center gap-3">
        <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-primary/10">
          <Settings className="h-6 w-6 text-cyan-400" />
        </div>
        <h1 className="text-3xl font-bold tracking-tight">Settings</h1>
        <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-[11px] font-semibold text-emerald-400">New page</span>
      </div>

      <div className="space-y-10">
        <section>
          <p className="mb-4 text-muted-foreground">
            Open <strong className="text-foreground">Settings</strong> from
            your picture in the top bar. Everything about your own account
            lives here:
          </p>
          <div className="grid gap-2">
            {rows.map((row) => (
              <div
                key={row.name}
                className="grid min-w-0 grid-cols-[110px_1fr] gap-3 rounded-lg border border-border bg-card p-3 text-sm text-muted-foreground sm:grid-cols-[150px_1fr]"
              >
                <strong className="text-foreground">{row.name}</strong>
                <span>{row.text}</span>
              </div>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}
