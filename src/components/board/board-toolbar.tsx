"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Search, X, Upload, Sparkles, Archive, SlidersHorizontal } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import dynamic from "next/dynamic";
import { getLabelColorConfig } from "@/lib/utils";
import type { BoardColumnWithTasks, BoardLabel, User, BotProfile } from "@/types";

const ImportDialog = dynamic(() => import("./import-dialog").then((m) => m.ImportDialog), { ssr: false });
const AiGenerateDialog = dynamic(() => import("./ai-generate-dialog").then((m) => m.AiGenerateDialog), { ssr: false });

interface BoardToolbarProps {
  searchQuery: string;
  onSearchChange: (value: string) => void;
  assigneeFilter: string;
  onAssigneeChange: (value: string) => void;
  labelFilter: string[];
  onLabelFilterChange: (value: string[]) => void;
  dueDateFilter: string;
  onDueDateChange: (value: string) => void;
  teamMembers: User[];
  boardLabels: BoardLabel[];
  showArchived: boolean;
  onShowArchivedChange: (value: boolean) => void;
  archivedCount: number;
  columns: BoardColumnWithTasks[];
  ideaId: string;
  ideaDescription?: string;
  currentUserId: string;
  canUseAi?: boolean;
  hasByokKey?: boolean;
  starterCredits?: number;
  botProfiles?: BotProfile[];
  isReadOnly?: boolean;
}

export function BoardToolbar({
  searchQuery,
  onSearchChange,
  assigneeFilter,
  onAssigneeChange,
  labelFilter,
  onLabelFilterChange,
  dueDateFilter,
  onDueDateChange,
  teamMembers,
  boardLabels,
  showArchived,
  onShowArchivedChange,
  archivedCount,
  columns,
  ideaId,
  ideaDescription = "",
  currentUserId,
  canUseAi = false,
  hasByokKey = false,
  starterCredits = 0,
  botProfiles = [],
  isReadOnly = false,
}: BoardToolbarProps) {
  const [importOpen, setImportOpen] = useState(false);
  const [aiGenerateOpen, setAiGenerateOpen] = useState(false);
  const [filterSheetOpen, setFilterSheetOpen] = useState(false);

  function handleLabelToggle(labelId: string) {
    if (labelFilter.includes(labelId)) {
      onLabelFilterChange(labelFilter.filter((id) => id !== labelId));
    } else {
      onLabelFilterChange([...labelFilter, labelId]);
    }
  }

  const hasFilters = searchQuery || assigneeFilter !== "all" || labelFilter.length > 0 || dueDateFilter !== "all";

  const activeFilterCount = (assigneeFilter !== "all" ? 1 : 0) + labelFilter.length + (dueDateFilter !== "all" ? 1 : 0);

  const filterControls = (
    <>
      {/* Assignee filter */}
      <Select value={assigneeFilter} onValueChange={onAssigneeChange}>
        <SelectTrigger className="h-8 w-full md:w-36 text-xs">
          <SelectValue placeholder="Assignee" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All members</SelectItem>
          <SelectItem value="unassigned">Unassigned</SelectItem>
          {teamMembers.map((member) => (
            <SelectItem key={member.id} value={member.id}>
              {member.full_name ?? member.email}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      {/* Label filter */}
      {boardLabels.length > 0 && (
        <Popover>
          <PopoverTrigger asChild>
            <Button variant="outline" size="sm" className="h-8 w-full md:w-auto text-xs">
              Labels
              {labelFilter.length > 0 && (
                <span className="ml-1 rounded-full bg-primary px-1.5 text-[10px] text-primary-foreground">
                  {labelFilter.length}
                </span>
              )}
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-52 p-2" align="start">
            <p className="mb-2 text-xs font-medium text-muted-foreground">Filter by labels</p>
            <div className="space-y-1">
              {boardLabels.map((label) => {
                const config = getLabelColorConfig(label.color);
                return (
                  <div key={label.id} className="flex items-center gap-2 rounded-md px-1 py-1 hover:bg-muted/50">
                    <Checkbox
                      checked={labelFilter.includes(label.id)}
                      onCheckedChange={() => handleLabelToggle(label.id)}
                    />
                    <span className={`h-3 w-3 shrink-0 rounded-sm ${config.swatchColor}`} />
                    <span className="text-xs font-medium">{label.name}</span>
                  </div>
                );
              })}
            </div>
          </PopoverContent>
        </Popover>
      )}

      {/* Due date filter */}
      <Select value={dueDateFilter} onValueChange={onDueDateChange}>
        <SelectTrigger className="h-8 w-full md:w-32 text-xs">
          <SelectValue placeholder="Due date" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All dates</SelectItem>
          <SelectItem value="overdue">Overdue</SelectItem>
          <SelectItem value="due_soon">Due soon</SelectItem>
        </SelectContent>
      </Select>

      {/* Show archived toggle */}
      {archivedCount > 0 && (
        <Button
          variant={showArchived ? "secondary" : "ghost"}
          size="sm"
          className="h-8 w-full md:w-auto gap-1.5 text-xs"
          onClick={() => onShowArchivedChange(!showArchived)}
        >
          <Archive className="h-3.5 w-3.5" />
          {showArchived ? "Hide" : "Show"} archived ({archivedCount})
        </Button>
      )}

      {/* Clear filters */}
      {hasFilters && (
        <Button
          variant="ghost"
          size="sm"
          className="h-8 w-full md:w-auto gap-1 text-xs text-muted-foreground"
          onClick={() => {
            onSearchChange("");
            onAssigneeChange("all");
            onLabelFilterChange([]);
            onDueDateChange("all");
          }}
        >
          <X className="h-3 w-3" />
          Clear filters
        </Button>
      )}
    </>
  );

  return (
    <div className="mb-4 flex flex-wrap items-center gap-2">
      {/* Search — always visible */}
      <div className="relative w-full md:w-auto">
        <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={searchQuery}
          onChange={(e) => onSearchChange(e.target.value)}
          placeholder="Search tasks..."
          className="h-8 w-full md:w-48 pl-8 text-xs"
        />
      </div>

      {/* Mobile: Filters sheet trigger */}
      <Sheet open={filterSheetOpen} onOpenChange={setFilterSheetOpen}>
        <SheetTrigger asChild>
          <Button variant="outline" size="sm" className="h-8 gap-1.5 text-xs md:hidden">
            <SlidersHorizontal className="h-3.5 w-3.5" />
            Filters
            {activeFilterCount > 0 && (
              <span className="ml-1 rounded-full bg-primary px-1.5 text-[10px] text-primary-foreground">
                {activeFilterCount}
              </span>
            )}
          </Button>
        </SheetTrigger>
        <SheetContent side="bottom" className="max-h-[80vh]">
          <SheetHeader>
            <SheetTitle>Filters</SheetTitle>
          </SheetHeader>
          <div className="mt-4 flex flex-col gap-3">{filterControls}</div>
        </SheetContent>
      </Sheet>

      {/* Desktop: inline filters */}
      <div className="hidden md:contents">{filterControls}</div>

      {!isReadOnly && (
        <div className="ml-auto flex gap-2">
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <span tabIndex={!canUseAi ? 0 : undefined}>
                  <Button
                    variant="outline"
                    size="sm"
                    className={`h-8 gap-1.5 text-xs ${!canUseAi ? "pointer-events-none opacity-50" : ""}`}
                    onClick={() => {
                      if (!canUseAi) return;
                      setAiGenerateOpen(true);
                    }}
                  >
                    <Sparkles className="h-3.5 w-3.5" />
                    <span className="hidden sm:inline">AI Generate</span>
                    {!hasByokKey && starterCredits > 0 && (
                      <span className="rounded-full bg-primary px-1.5 text-[10px] leading-none text-primary-foreground">
                        {starterCredits}
                      </span>
                    )}
                  </Button>
                </span>
              </TooltipTrigger>
              {!canUseAi && (
                <TooltipContent side="bottom">
                  You&apos;ve used all 10 free AI credits — add your API key in profile settings for unlimited use
                </TooltipContent>
              )}
            </Tooltip>
          </TooltipProvider>
          <Button
            variant="outline"
            size="sm"
            className="h-8 gap-1.5 text-xs"
            onClick={() => setImportOpen(true)}
          >
            <Upload className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Import</span>
          </Button>
        </div>
      )}

      {!isReadOnly && (
        <ImportDialog
          open={importOpen}
          onOpenChange={setImportOpen}
          ideaId={ideaId}
          currentUserId={currentUserId}
          columns={columns}
          boardLabels={boardLabels}
          teamMembers={teamMembers}
        />
      )}

      {!isReadOnly && (
        <AiGenerateDialog
          open={aiGenerateOpen}
          onOpenChange={setAiGenerateOpen}
          ideaId={ideaId}
          ideaDescription={ideaDescription}
          currentUserId={currentUserId}
          columns={columns}
          boardLabels={boardLabels}
          teamMembers={teamMembers}
          bots={botProfiles}
        />
      )}
    </div>
  );
}
