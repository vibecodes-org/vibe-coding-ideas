"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, MoreHorizontal, Pencil, Trash2, LayoutTemplate, Lock } from "lucide-react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { toast } from "sonner";
import { deleteLibraryTemplate, updateLibraryTemplate } from "@/actions/admin-templates";
import { TemplateEditorDialog } from "./template-editor-dialog";
import type { WorkflowLibraryTemplate } from "@/types";

interface AdminTemplatesDashboardProps {
  templates: WorkflowLibraryTemplate[];
  onRefresh: () => void;
}

export function AdminTemplatesDashboard({ templates, onRefresh }: AdminTemplatesDashboardProps) {
  const router = useRouter();
  const [deleteTarget, setDeleteTarget] = useState<WorkflowLibraryTemplate | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [editTemplate, setEditTemplate] = useState<WorkflowLibraryTemplate | null>(null);

  async function handleDelete() {
    if (!deleteTarget) return;
    try {
      await deleteLibraryTemplate(deleteTarget.id);
      setDeleteTarget(null);
      toast.success(`Template "${deleteTarget.name}" deleted`);
      onRefresh();
      router.refresh();
    } catch {
      toast.error("Failed to delete template");
    }
  }

  async function handleToggleActive(template: WorkflowLibraryTemplate) {
    try {
      await updateLibraryTemplate(template.id, { is_active: !template.is_active });
      toast.success(
        template.is_active ? `"${template.name}" hidden from library` : `"${template.name}" visible in library`
      );
      router.refresh();
    } catch {
      toast.error("Failed to update template");
    }
  }

  function gateCount(steps: { requires_approval?: boolean }[]) {
    return steps.filter((s) => s.requires_approval).length;
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold">Workflow Library</h2>
          <p className="text-sm text-muted-foreground">
            {templates.length} template{templates.length !== 1 ? "s" : ""} available for users to import
          </p>
        </div>
        <Button size="sm" onClick={() => setCreateOpen(true)}>
          <Plus className="mr-2 h-4 w-4" />
          Create Template
        </Button>
      </div>

      {/* Table */}
      <div className="max-h-[500px] overflow-y-auto rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-[180px]">Name</TableHead>
              <TableHead>Description</TableHead>
              <TableHead className="w-[70px] text-center">Steps</TableHead>
              <TableHead className="w-[70px] text-center">Gates</TableHead>
              <TableHead className="w-[80px] text-center">Active</TableHead>
              <TableHead className="w-[50px]" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {templates.map((tpl) => {
              const gates = gateCount(tpl.steps);
              return (
                <TableRow key={tpl.id} className={!tpl.is_active ? "opacity-50" : undefined}>
                  <TableCell className="p-2">
                    <span className="text-sm font-medium truncate block max-w-[170px]">
                      {tpl.name}
                    </span>
                  </TableCell>
                  <TableCell className="p-2">
                    <p className="text-xs text-muted-foreground line-clamp-2">
                      {tpl.description || "--"}
                    </p>
                  </TableCell>
                  <TableCell className="p-2 text-center">
                    <span className="text-sm font-medium">{tpl.steps.length}</span>
                  </TableCell>
                  <TableCell className="p-2 text-center">
                    {gates > 0 ? (
                      <Badge variant="outline" className="text-[10px] border-amber-500/25 bg-amber-500/15 text-amber-400">
                        <Lock className="mr-0.5 h-2.5 w-2.5" />
                        {gates}
                      </Badge>
                    ) : (
                      <span className="text-xs text-muted-foreground">0</span>
                    )}
                  </TableCell>
                  <TableCell className="p-2 text-center">
                    <Switch
                      size="sm"
                      checked={tpl.is_active}
                      onCheckedChange={() => handleToggleActive(tpl)}
                    />
                  </TableCell>
                  <TableCell className="p-2">
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon" className="h-7 w-7">
                          <MoreHorizontal className="h-4 w-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onClick={() => setEditTemplate(tpl)}>
                          <Pencil className="mr-2 h-4 w-4" />
                          Edit
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          onClick={() => setDeleteTarget(tpl)}
                          className="text-destructive"
                        >
                          <Trash2 className="mr-2 h-4 w-4" />
                          Delete
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </TableCell>
                </TableRow>
              );
            })}
            {templates.length === 0 && (
              <TableRow>
                <TableCell colSpan={6} className="p-8 text-center">
                  <div className="flex flex-col items-center gap-2 text-muted-foreground">
                    <LayoutTemplate className="h-8 w-8" />
                    <p className="text-sm">No library templates yet.</p>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setCreateOpen(true)}
                    >
                      <Plus className="mr-2 h-4 w-4" />
                      Create your first template
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      {/* Create / Edit Dialog */}
      <TemplateEditorDialog
        open={createOpen || !!editTemplate}
        onOpenChange={(open) => {
          if (!open) {
            setCreateOpen(false);
            setEditTemplate(null);
          }
        }}
        editTemplate={editTemplate}
        onSuccess={() => {
          setCreateOpen(false);
          setEditTemplate(null);
          onRefresh();
          router.refresh();
        }}
      />

      {/* Delete confirmation */}
      <AlertDialog open={!!deleteTarget} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete template?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete <strong>{deleteTarget?.name}</strong> from the library.
              Boards that have already imported this template will not be affected.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
