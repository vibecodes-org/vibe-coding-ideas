"use client";

import { useState } from "react";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DueDateBadge } from "@/components/board/due-date-badge";
import { TaskLabelBadges } from "@/components/board/task-label-badges";
import type { DashboardTask } from "@/types";

const INITIAL_LIMIT = 5;

interface MyTasksListProps {
  tasks: DashboardTask[];
}

export function MyTasksList({ tasks }: MyTasksListProps) {
  const [showAll, setShowAll] = useState(false);

  if (tasks.length === 0) {
    return (
      <div className="py-4 text-center">
        <p className="text-sm text-muted-foreground">
          No tasks assigned to you.
        </p>
        <p className="mt-1 text-xs text-muted-foreground">
          Tasks appear here when you&apos;re assigned to them on a{" "}
          <Link href="/ideas" className="text-primary hover:underline">
            project board
          </Link>
          .
        </p>
      </div>
    );
  }

  const visibleTasks =
    showAll || tasks.length <= INITIAL_LIMIT
      ? tasks
      : tasks.slice(0, INITIAL_LIMIT);

  return (
    <div className="space-y-2">
      {visibleTasks.map((task) => (
        <Link
          key={task.id}
          href={`/ideas/${task.idea.id}/board?taskId=${task.id}`}
          className="flex items-center gap-3 rounded-md border border-border p-3 transition-colors hover:bg-muted"
        >
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium truncate">{task.title}</p>
            <p className="text-xs text-muted-foreground truncate">
              {task.idea.title}
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <TaskLabelBadges labels={task.labels} maxVisible={2} />
            <Badge variant="outline" className="text-[10px]">
              {task.column.title}
            </Badge>
            {task.due_date && <DueDateBadge dueDate={task.due_date} />}
            {task.workflow_step_total > 0 && (
              <span className="text-[10px] text-muted-foreground">
                {task.workflow_step_completed}/{task.workflow_step_total}
              </span>
            )}
          </div>
        </Link>
      ))}
      {!showAll && tasks.length > INITIAL_LIMIT && (
        <Button
          variant="ghost"
          size="sm"
          className="w-full text-xs text-muted-foreground"
          onClick={() => setShowAll(true)}
        >
          Show all ({tasks.length})
        </Button>
      )}
    </div>
  );
}
