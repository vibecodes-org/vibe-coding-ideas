import type { ReactNode } from "react";
import {
  ArrowUp,
  MessageSquare,
  CheckSquare,
  Bot,
  GripVertical,
  CircleCheckBig,
  Paperclip,
  Calendar,
  Users,
  Activity,
  ArrowRight,
  Plus,
} from "lucide-react";

/* ------------------------------------------------------------------ */
/*  Browser frame wrapper                                              */
/* ------------------------------------------------------------------ */

function BrowserFrame({
  children,
  url = "vibecodes.co.uk",
  className,
}: {
  children: ReactNode;
  url?: string;
  className?: string;
}) {
  return (
    <div
      className={`overflow-hidden rounded-xl border border-border/50 bg-background shadow-2xl shadow-black/25 ${className ?? ""}`}
    >
      <div className="flex items-center gap-2 border-b border-border/50 bg-muted/30 px-4 py-2">
        <div className="flex gap-1.5">
          <div className="h-2.5 w-2.5 rounded-full bg-red-400/60" />
          <div className="h-2.5 w-2.5 rounded-full bg-yellow-400/60" />
          <div className="h-2.5 w-2.5 rounded-full bg-green-400/60" />
        </div>
        <div className="flex-1">
          <div className="mx-auto max-w-xs rounded-md bg-muted/60 px-3 py-0.5 text-center text-[11px] text-muted-foreground/60">
            {url}
          </div>
        </div>
      </div>
      {children}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Label badge                                                        */
/* ------------------------------------------------------------------ */

const LABEL_STYLES: Record<string, string> = {
  blue: "bg-blue-500/15 text-blue-400 border-blue-500/25",
  green: "bg-emerald-500/15 text-emerald-400 border-emerald-500/25",
  purple: "bg-purple-500/15 text-purple-400 border-purple-500/25",
  amber: "bg-amber-500/15 text-amber-400 border-amber-500/25",
  red: "bg-red-500/15 text-red-400 border-red-500/25",
  gray: "bg-muted text-muted-foreground border-border",
};

function Label({ name, color }: { name: string; color: string }) {
  return (
    <span
      className={`inline-flex rounded border px-1.5 py-0.5 text-[10px] font-medium leading-none ${LABEL_STYLES[color] ?? LABEL_STYLES.gray}`}
    >
      {name}
    </span>
  );
}

/* ------------------------------------------------------------------ */
/*  Mini avatar                                                        */
/* ------------------------------------------------------------------ */

function Avatar({
  name,
  isBot,
  size = "sm",
}: {
  name: string;
  isBot?: boolean;
  size?: "sm" | "xs";
}) {
  const dim = size === "sm" ? "h-5 w-5 text-[10px]" : "h-4 w-4 text-[8px]";
  const initial = name.charAt(0).toUpperCase();
  return (
    <div className="relative">
      <div
        className={`${dim} flex items-center justify-center rounded-full bg-primary/20 font-semibold text-primary`}
      >
        {initial}
      </div>
      {isBot && (
        <Bot className="absolute -right-0.5 -bottom-0.5 h-2.5 w-2.5 rounded-full bg-background text-primary" />
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Task card (inside board column)                                    */
/* ------------------------------------------------------------------ */

interface MockTask {
  title: string;
  labels?: { name: string; color: string }[];
  dueDate?: string;
  checkDone?: number;
  checkTotal?: number;
  comments?: number;
  attachments?: number;
  assignee?: { name: string; isBot?: boolean };
}

function TaskCard({ task }: { task: MockTask }) {
  const hasSteps =
    task.checkTotal !== undefined && task.checkTotal > 0;
  const stepsDone =
    hasSteps && task.checkDone === task.checkTotal;

  return (
    <div className="rounded-md border border-border bg-background p-2.5 shadow-sm">
      {/* Labels */}
      {task.labels && task.labels.length > 0 && (
        <div className="mb-1.5 flex flex-wrap gap-1">
          {task.labels.map((l) => (
            <Label key={l.name} name={l.name} color={l.color} />
          ))}
        </div>
      )}

      {/* Title */}
      <p className="text-xs font-medium leading-snug">{task.title}</p>

      {/* Metadata row */}
      <div className="mt-2 flex items-center gap-2.5 text-[10px] text-muted-foreground">
        {task.dueDate && (
          <span className="flex items-center gap-0.5">
            <Calendar className="h-3 w-3" />
            {task.dueDate}
          </span>
        )}
        {hasSteps && (
          <span
            className={`flex items-center gap-0.5 ${stepsDone ? "text-emerald-400" : ""}`}
          >
            <CheckSquare className="h-3 w-3" />
            {task.checkDone}/{task.checkTotal}
          </span>
        )}
        {(task.attachments ?? 0) > 0 && (
          <span className="flex items-center gap-0.5">
            <Paperclip className="h-3 w-3" />
            {task.attachments}
          </span>
        )}
        {(task.comments ?? 0) > 0 && (
          <span className="flex items-center gap-0.5">
            <MessageSquare className="h-3 w-3" />
            {task.comments}
          </span>
        )}
        {/* Spacer to push assignee right */}
        {task.assignee && <span className="flex-1" />}
        {task.assignee && (
          <Avatar
            name={task.assignee.name}
            isBot={task.assignee.isBot}
            size="xs"
          />
        )}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Board column                                                       */
/* ------------------------------------------------------------------ */

function BoardColumn({
  name,
  count,
  isDone,
  tasks,
}: {
  name: string;
  count: number;
  isDone?: boolean;
  tasks: MockTask[];
}) {
  return (
    <div className="flex min-w-[200px] flex-1 flex-col rounded-lg border border-border bg-muted/40">
      {/* Column header */}
      <div className="flex items-center gap-1.5 border-b border-border px-3 py-2">
        <GripVertical className="h-3.5 w-3.5 text-muted-foreground/40" />
        {isDone && (
          <CircleCheckBig className="h-3.5 w-3.5 text-emerald-500" />
        )}
        <span className="text-xs font-semibold">{name}</span>
        <span className="text-[10px] text-muted-foreground">({count})</span>
      </div>

      {/* Task list */}
      <div className="flex-1 space-y-2 p-2">
        {tasks.map((task) => (
          <TaskCard key={task.title} task={task} />
        ))}
      </div>

      {/* Add task button */}
      {!isDone && (
        <div className="border-t border-border/50 px-2 py-1.5">
          <div className="flex items-center gap-1 rounded-md px-2 py-1 text-xs text-muted-foreground/60">
            <Plus className="h-3.5 w-3.5" />
            Add task
          </div>
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  EXPORT: Board Preview                                              */
/* ------------------------------------------------------------------ */

export function BoardPreview() {
  return (
    <BrowserFrame url="vibecodes.co.uk/ideas/weather-app/board">
      <div className="bg-background p-3 sm:p-4">
        {/* Board header */}
        <div className="mb-3 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-semibold">Weather Dashboard App</h3>
            <span className="rounded-full bg-green-500/15 px-2 py-0.5 text-[10px] font-medium text-green-400 border border-green-500/25">
              In Progress
            </span>
          </div>
          <div className="flex items-center gap-1.5 rounded-full bg-primary/10 px-2.5 py-1 text-[10px] text-primary">
            <Bot className="h-3 w-3" />
            <span className="hidden sm:inline">Claude is working&hellip;</span>
            <span className="sm:hidden">AI active</span>
          </div>
        </div>

        {/* Columns */}
        <div className="flex gap-3 overflow-x-auto pb-1">
          <BoardColumn
            name="To Do"
            count={3}
            tasks={[
              {
                title: "Add 7-day forecast view",
                labels: [{ name: "Frontend", color: "green" }],
                dueDate: "Mar 5",
                comments: 2,
              },
              {
                title: "Implement geolocation API",
                labels: [
                  { name: "Backend", color: "blue" },
                  { name: "API", color: "purple" },
                ],
                attachments: 1,
              },
              {
                title: "Fix temperature unit toggle",
                labels: [{ name: "Bug", color: "red" }],
                comments: 1,
              },
            ]}
          />
          <BoardColumn
            name="In Progress"
            count={2}
            tasks={[
              {
                title: "Design responsive dashboard layout",
                labels: [{ name: "Design", color: "purple" }],
                checkDone: 3,
                checkTotal: 5,
                assignee: { name: "Nick" },
              },
              {
                title: "Build weather API integration",
                labels: [
                  { name: "AI", color: "amber" },
                  { name: "MCP", color: "amber" },
                ],
                comments: 3,
                assignee: { name: "Claude", isBot: true },
              },
            ]}
          />
          <BoardColumn
            name="Done"
            count={2}
            isDone
            tasks={[
              {
                title: "Project setup & scaffolding",
                labels: [{ name: "Setup", color: "gray" }],
                checkDone: 4,
                checkTotal: 4,
              },
              {
                title: "Set up authentication flow",
                labels: [{ name: "Backend", color: "blue" }],
                comments: 1,
                checkDone: 3,
                checkTotal: 3,
              },
            ]}
          />
        </div>
      </div>
    </BrowserFrame>
  );
}

/* ------------------------------------------------------------------ */
/*  EXPORT: Idea Card Preview                                          */
/* ------------------------------------------------------------------ */

export function IdeaCardPreview() {
  return (
    <BrowserFrame url="vibecodes.co.uk/ideas">
      <div className="bg-background p-3 sm:p-4 space-y-3">
        {/* Idea card 1 - featured */}
        <div className="rounded-lg border border-border p-3 sm:p-4 transition-colors hover:border-primary/30">
          <div className="flex gap-3 sm:gap-4">
            {/* Vote button */}
            <div className="flex flex-col items-center gap-0.5 pt-0.5">
              <ArrowUp className="h-4 w-4 text-primary" />
              <span className="text-sm font-bold text-primary">12</span>
            </div>

            {/* Content */}
            <div className="flex-1 min-w-0">
              <div className="flex items-start justify-between gap-2">
                <h3 className="text-sm font-semibold leading-snug sm:text-base">
                  Weather Dashboard App
                </h3>
                <span className="shrink-0 rounded-full bg-green-500/15 px-2 py-0.5 text-[10px] font-medium text-green-400 border border-green-500/25">
                  In Progress
                </span>
              </div>
              <p className="mt-1 text-xs text-muted-foreground line-clamp-2 sm:text-sm">
                A beautiful, responsive weather dashboard that shows real-time
                forecasts, radar maps, and severe weather alerts. Uses OpenWeather
                API with AI-powered natural language queries.
              </p>

              {/* Tags */}
              <div className="mt-2 flex flex-wrap gap-1.5">
                <span className="rounded-md bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                  weather
                </span>
                <span className="rounded-md bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                  react
                </span>
                <span className="rounded-md bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                  api
                </span>
              </div>

              {/* Meta row */}
              <div className="mt-2.5 flex items-center gap-3 text-[10px] text-muted-foreground sm:text-xs">
                <div className="flex items-center gap-1">
                  <Avatar name="Nick" size="xs" />
                  <span>Nick</span>
                </div>
                <span>2d ago</span>
                <span className="flex items-center gap-0.5">
                  <MessageSquare className="h-3 w-3" /> 8
                </span>
                <span className="flex items-center gap-0.5">
                  <Users className="h-3 w-3" /> 3
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* Idea card 2 - simpler */}
        <div className="rounded-lg border border-border p-3 sm:p-4">
          <div className="flex gap-3 sm:gap-4">
            <div className="flex flex-col items-center gap-0.5 pt-0.5">
              <ArrowUp className="h-4 w-4 text-muted-foreground" />
              <span className="text-sm font-bold text-muted-foreground">7</span>
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-start justify-between gap-2">
                <h3 className="text-sm font-semibold leading-snug sm:text-base">
                  AI Code Review Bot
                </h3>
                <span className="shrink-0 rounded-full bg-blue-500/15 px-2 py-0.5 text-[10px] font-medium text-blue-400 border border-blue-500/25">
                  Proposed
                </span>
              </div>
              <p className="mt-1 text-xs text-muted-foreground line-clamp-2 sm:text-sm">
                A GitHub bot that uses Claude to review PRs, suggest improvements,
                and catch bugs before they reach production.
              </p>
              <div className="mt-2.5 flex items-center gap-3 text-[10px] text-muted-foreground sm:text-xs">
                <div className="flex items-center gap-1">
                  <Avatar name="Sarah" size="xs" />
                  <span>Sarah</span>
                </div>
                <span>5d ago</span>
                <span className="flex items-center gap-0.5">
                  <MessageSquare className="h-3 w-3" /> 3
                </span>
                <span className="flex items-center gap-0.5">
                  <Users className="h-3 w-3" /> 1
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </BrowserFrame>
  );
}

/* ------------------------------------------------------------------ */
/*  EXPORT: Agent Activity Preview                                     */
/* ------------------------------------------------------------------ */

export function McpAgentPreview() {
  return (
    <BrowserFrame url="vibecodes.co.uk/dashboard">
      <div className="bg-background p-3 sm:p-4">
        {/* Agent header */}
        <div className="flex items-center gap-3 mb-4">
          <div className="flex h-9 w-9 items-center justify-center rounded-full bg-primary/15">
            <Bot className="h-5 w-5 text-primary" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <span className="text-sm font-semibold">Backend Dev</span>
              <span className="rounded-full bg-green-500/15 px-2 py-0.5 text-[10px] font-medium text-green-400 border border-green-500/25">
                MCP Active
              </span>
            </div>
            <p className="text-[11px] text-muted-foreground">
              AI Agent &middot; Nick&apos;s team
            </p>
          </div>
        </div>

        {/* Assigned tasks */}
        <div className="mb-4">
          <div className="mb-2 flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
            Assigned Tasks
            <span className="rounded-full bg-muted px-1.5 text-[10px]">2</span>
          </div>
          <div className="space-y-1.5">
            <div className="rounded-md border border-border p-2">
              <p className="text-xs font-medium">Build weather API integration</p>
              <p className="text-[10px] text-muted-foreground">
                Weather Dashboard &middot;{" "}
                <span className="text-amber-400">In Progress</span>
              </p>
            </div>
            <div className="rounded-md border border-border p-2">
              <p className="text-xs font-medium">Fix temp unit toggle</p>
              <p className="text-[10px] text-muted-foreground">
                Weather Dashboard &middot;{" "}
                <span className="text-blue-400">To Do</span>
              </p>
            </div>
          </div>
        </div>

        {/* Activity feed */}
        <div>
          <div className="mb-2 flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
            Recent Activity
          </div>
          <div className="space-y-2">
            {[
              {
                action: "Created task",
                target: "Build weather API",
                time: "2m",
                icon: <Plus className="h-3 w-3 text-emerald-400" />,
              },
              {
                action: "Moved to",
                target: "In Progress",
                time: "2m",
                icon: <ArrowRight className="h-3 w-3 text-blue-400" />,
              },
              {
                action: "Commented on",
                target: "Fix temp unit toggle",
                time: "5m",
                icon: <MessageSquare className="h-3 w-3 text-amber-400" />,
                comment:
                  "Found the issue \u2014 Math.round() in conversion loses precision. Applying fix now.",
              },
            ].map((item, i) => (
              <div key={i} className="border-l-2 border-border pl-2.5">
                <div className="flex items-start gap-1.5">
                  <div className="mt-0.5 shrink-0">{item.icon}</div>
                  <div className="flex-1 min-w-0">
                    <p className="text-[11px] leading-snug">
                      <span className="text-muted-foreground">
                        {item.action}
                      </span>{" "}
                      <span className="font-medium">{item.target}</span>
                    </p>
                    {item.comment && (
                      <div className="mt-1 rounded-md border border-border bg-muted/30 px-2 py-1">
                        <p className="text-[10px] text-muted-foreground line-clamp-2">
                          {item.comment}
                        </p>
                      </div>
                    )}
                  </div>
                  <span className="shrink-0 text-[10px] text-muted-foreground/60">
                    {item.time}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </BrowserFrame>
  );
}

/* ------------------------------------------------------------------ */
/*  EXPORT: Agent Activity Preview                                     */
/* ------------------------------------------------------------------ */

export function AgentActivityPreview() {
  return (
    <BrowserFrame url="vibecodes.co.uk/dashboard">
      <div className="bg-background p-3 sm:p-4">
        {/* Agent header */}
        <div className="flex items-center gap-3 mb-4">
          <div className="flex h-9 w-9 items-center justify-center rounded-full bg-primary/15">
            <Bot className="h-5 w-5 text-primary" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <span className="text-sm font-semibold">Claude Code</span>
              <span className="rounded-full bg-green-500/15 px-2 py-0.5 text-[10px] font-medium text-green-400 border border-green-500/25">
                MCP Active
              </span>
            </div>
            <p className="text-[11px] text-muted-foreground">
              AI Development Assistant
            </p>
          </div>
        </div>

        {/* Assigned tasks */}
        <div className="mb-4">
          <div className="mb-2 flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
            <CheckSquare className="h-3.5 w-3.5" />
            Assigned Tasks
            <span className="rounded-full bg-muted px-1.5 text-[10px]">2</span>
          </div>
          <div className="space-y-1.5">
            <div className="flex items-center gap-2 rounded-md border border-border p-2">
              <div className="flex-1 min-w-0">
                <p className="text-xs font-medium truncate">Build weather API integration</p>
                <p className="text-[10px] text-muted-foreground">
                  Weather Dashboard App &middot;{" "}
                  <span className="text-amber-400">In Progress</span>
                </p>
              </div>
              <ArrowRight className="h-3 w-3 text-muted-foreground/40 shrink-0" />
            </div>
            <div className="flex items-center gap-2 rounded-md border border-border p-2">
              <div className="flex-1 min-w-0">
                <p className="text-xs font-medium truncate">Fix temperature unit toggle</p>
                <p className="text-[10px] text-muted-foreground">
                  Weather Dashboard App &middot;{" "}
                  <span className="text-blue-400">To Do</span>
                </p>
              </div>
              <ArrowRight className="h-3 w-3 text-muted-foreground/40 shrink-0" />
            </div>
          </div>
        </div>

        {/* Activity feed */}
        <div>
          <div className="mb-2 flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
            <Activity className="h-3.5 w-3.5" />
            Recent Activity
          </div>
          <div className="space-y-2">
            {[
              {
                action: "Created task",
                target: "Build weather API integration",
                time: "2m ago",
                icon: <Plus className="h-3 w-3 text-emerald-400" />,
              },
              {
                action: "Moved to",
                target: "In Progress",
                time: "2m ago",
                icon: <ArrowRight className="h-3 w-3 text-blue-400" />,
              },
              {
                action: "Commented on",
                target: "Fix temperature unit toggle",
                time: "5m ago",
                icon: <MessageSquare className="h-3 w-3 text-amber-400" />,
                comment:
                  "The issue is in the conversion function — it uses Math.round() which loses precision for Kelvin.",
              },
              {
                action: "Self-assigned",
                target: "Build weather API integration",
                time: "8m ago",
                icon: <Bot className="h-3 w-3 text-purple-400" />,
              },
            ].map((item, i) => (
              <div
                key={i}
                className="border-l-2 border-border pl-2.5"
              >
                <div className="flex items-start gap-1.5">
                  <div className="mt-0.5 shrink-0">{item.icon}</div>
                  <div className="flex-1 min-w-0">
                    <p className="text-[11px] leading-snug">
                      <span className="text-muted-foreground">
                        {item.action}
                      </span>{" "}
                      <span className="font-medium">{item.target}</span>
                    </p>
                    {item.comment && (
                      <div className="mt-1 rounded-md border border-border bg-muted/30 px-2 py-1">
                        <p className="text-[10px] text-muted-foreground line-clamp-2">
                          {item.comment}
                        </p>
                      </div>
                    )}
                  </div>
                  <span className="shrink-0 text-[10px] text-muted-foreground/60">
                    {item.time}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </BrowserFrame>
  );
}
