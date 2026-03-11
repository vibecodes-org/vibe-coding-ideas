"use client";

import { useState } from "react";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ImportPreviewTable } from "./import-preview-table";
import {
  parseBulkText,
  executeBulkImport,
  type ImportProgress,
} from "@/lib/import";
import type { BoardColumnWithTasks, BoardLabel, User } from "@/types";
import { toast } from "sonner";

interface ImportBulkTextTabProps {
  ideaId: string;
  currentUserId: string;
  columns: BoardColumnWithTasks[];
  boardLabels: BoardLabel[];
  teamMembers: User[];
  onComplete: () => void;
  onImportingChange: (importing: boolean) => void;
  onProgress: (progress: ImportProgress) => void;
}

export function ImportBulkTextTab({
  ideaId,
  currentUserId,
  columns,
  boardLabels,
  teamMembers,
  onComplete,
  onImportingChange,
  onProgress,
}: ImportBulkTextTabProps) {
  const [text, setText] = useState("");
  const [targetColumnId, setTargetColumnId] = useState(columns[0]?.id ?? "");

  const tasks = text.trim() ? parseBulkText(text) : [];

  async function handleImport() {
    if (tasks.length === 0) return;

    onImportingChange(true);
    try {
      const tasksWithColumn = tasks.map((t) => ({
        ...t,
        columnName: undefined,
      }));

      const result = await executeBulkImport(
        tasksWithColumn,
        ideaId,
        currentUserId,
        columns,
        {},
        targetColumnId,
        boardLabels,
        teamMembers,
        onProgress
      );

      if (result.errors.length > 0) {
        toast.error(`Imported ${result.created} tasks with errors`, {
          description: result.errors[0],
        });
      } else {
        toast.success(`Imported ${result.created} task${result.created !== 1 ? "s" : ""}`);
      }
      onImportingChange(false);
      onComplete();
    } catch (err) {
      toast.error("Import failed", {
        description: err instanceof Error ? err.message : "Unknown error",
      });
      onImportingChange(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <p className="text-xs text-muted-foreground">
          Paste tasks, one per line. Lines starting with{" "}
          <code className="rounded bg-muted px-1">- [ ]</code> become workflow
          steps on the preceding task.
        </p>
        <Textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={"Design landing page\n- [ ] Create wireframe\n- [ ] Pick color palette\nSet up CI/CD\nWrite API docs"}
          rows={8}
        />
      </div>

      <div className="flex items-center gap-3">
        <span className="text-sm">Target column:</span>
        <Select value={targetColumnId} onValueChange={setTargetColumnId}>
          <SelectTrigger className="h-8 w-48 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {columns.map((col) => (
              <SelectItem key={col.id} value={col.id}>
                {col.title}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {tasks.length > 0 && (
        <ImportPreviewTable
          tasks={tasks}
          columns={columns}
          columnMapping={{}}
          defaultColumnId={targetColumnId}
        />
      )}

      <Button
        onClick={handleImport}
        disabled={tasks.length === 0 || !targetColumnId}
        className="w-full"
      >
        Import {tasks.length} task{tasks.length !== 1 ? "s" : ""}
      </Button>
    </div>
  );
}
