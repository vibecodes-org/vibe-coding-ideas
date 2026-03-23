"use client";

import { useState, useEffect, useRef, useCallback, useMemo, useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { Search, X, ChevronLeft, ChevronRight, Loader2 } from "lucide-react";
import { IdeaCard } from "./idea-card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { SORT_OPTIONS, STATUS_CONFIG } from "@/lib/constants";
import type { IdeaWithAuthor, IdeaStatus, SortOption } from "@/types";

type FeedView = "all" | "mine" | "collaborating";

interface IdeaFeedProps {
  ideas: IdeaWithAuthor[];
  userVotes: string[];
  taskCounts: Record<string, number>;
  latestDiscussions?: Record<string, { id: string; title: string }>;
  currentSort: SortOption;
  currentSearch: string;
  currentTag: string;
  currentStatus: string;
  currentView: FeedView;
  currentPage: number;
  totalPages: number;
  allTags: string[];
}

const VIEW_OPTIONS: { value: FeedView; label: string }[] = [
  { value: "all", label: "All Ideas" },
  { value: "mine", label: "My Ideas" },
  { value: "collaborating", label: "Collaborating" },
];

export function IdeaFeed({
  ideas,
  userVotes,
  taskCounts,
  latestDiscussions,
  currentSort,
  currentSearch,
  currentTag,
  currentStatus,
  currentView,
  currentPage,
  totalPages,
  allTags,
}: IdeaFeedProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [searchInput, setSearchInput] = useState(currentSearch);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const [isPending, startTransition] = useTransition();

  const updateParams = useCallback((updates: Record<string, string>) => {
    const params = new URLSearchParams(searchParams.toString());
    Object.entries(updates).forEach(([key, value]) => {
      if (value) {
        params.set(key, value);
      } else {
        params.delete(key);
      }
    });
    // Reset to page 1 when filters change (unless we're changing page)
    if (!("page" in updates)) {
      params.delete("page");
    }
    startTransition(() => {
      router.push(`/ideas?${params.toString()}`);
    });
  }, [searchParams, router, startTransition]);

  // Debounced search on keystroke
  useEffect(() => {
    // Don't trigger on initial render or when input matches current search
    if (searchInput === currentSearch) return;
    debounceRef.current = setTimeout(() => {
      updateParams({ q: searchInput });
    }, 300);
    return () => clearTimeout(debounceRef.current);
  }, [searchInput, currentSearch, updateParams]);

  // Client-side filtering for instant feedback while server search is in-flight
  const filteredIdeas = useMemo(() => {
    // If input matches current server search, use server results as-is
    if (!searchInput || searchInput === currentSearch) return ideas;
    // Otherwise, instantly filter the loaded ideas client-side
    const q = searchInput.toLowerCase();
    return ideas.filter(
      (idea) =>
        idea.title.toLowerCase().includes(q) ||
        idea.description?.toLowerCase().includes(q)
    );
  }, [ideas, searchInput, currentSearch]);

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    clearTimeout(debounceRef.current);
    updateParams({ q: searchInput });
  };

  const clearSearch = () => {
    clearTimeout(debounceRef.current);
    setSearchInput("");
    updateParams({ q: "" });
  };

  return (
    <div>
      <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <h1 className="text-2xl font-bold">Idea Feed</h1>
        <div className="flex items-center gap-2">
          <Select
            value={currentStatus || "all"}
            onValueChange={(v) => updateParams({ status: v === "all" ? "" : v })}
          >
            <SelectTrigger className="w-full sm:w-[150px]">
              <SelectValue placeholder="Status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All statuses</SelectItem>
              {(Object.entries(STATUS_CONFIG) as [IdeaStatus, { label: string }][]).map(
                ([value, config]) => (
                  <SelectItem key={value} value={value}>
                    {config.label}
                  </SelectItem>
                )
              )}
            </SelectContent>
          </Select>
          <Select
            value={currentSort}
            onValueChange={(v) => updateParams({ sort: v })}
          >
            <SelectTrigger className="w-full sm:w-[180px]">
              <SelectValue placeholder="Sort by" />
            </SelectTrigger>
            <SelectContent>
              {SORT_OPTIONS.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* View filter tabs */}
      <div className="mb-4 flex gap-1 rounded-lg border border-border bg-muted/30 p-1">
        {VIEW_OPTIONS.map((option) => (
          <button
            key={option.value}
            className={`flex-1 rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
              currentView === option.value
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            }`}
            onClick={() => updateParams({ view: option.value === "all" ? "" : option.value })}
          >
            {option.label}
          </button>
        ))}
      </div>

      {/* Search bar */}
      <form onSubmit={handleSearch} className="mb-4">
        <div className="relative">
          {isPending ? (
            <Loader2 className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-muted-foreground" />
          ) : (
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          )}
          <Input
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder="Search ideas..."
            className="pl-9"
          />
          {searchInput && (
            <button
              type="button"
              onClick={clearSearch}
              className="absolute right-3 top-1/2 -translate-y-1/2 cursor-pointer text-muted-foreground hover:text-foreground"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>
      </form>

      {/* Tag filter */}
      {allTags.length > 0 && (
        <div className="mb-6 flex flex-wrap gap-1.5">
          <Badge
            variant={currentTag === "" ? "default" : "outline"}
            className="cursor-pointer"
            onClick={() => updateParams({ tag: "" })}
          >
            All
          </Badge>
          {allTags.map((tag) => (
            <Badge
              key={tag}
              variant={currentTag === tag ? "default" : "outline"}
              className="cursor-pointer"
              onClick={() => updateParams({ tag: currentTag === tag ? "" : tag })}
            >
              {tag}
            </Badge>
          ))}
        </div>
      )}

      {/* Active filters */}
      {(currentSearch || currentTag || currentStatus) && (
        <div className="mb-4 flex items-center gap-2 text-sm text-muted-foreground">
          <span>Showing results for:</span>
          {currentSearch && (
            <Badge variant="secondary" className="gap-1">
              &quot;{currentSearch}&quot;
              <button className="cursor-pointer" onClick={clearSearch}>
                <X className="h-3 w-3" />
              </button>
            </Badge>
          )}
          {currentTag && (
            <Badge variant="secondary" className="gap-1">
              #{currentTag}
              <button className="cursor-pointer" onClick={() => updateParams({ tag: "" })}>
                <X className="h-3 w-3" />
              </button>
            </Badge>
          )}
          {currentStatus && (
            <Badge variant="secondary" className="gap-1">
              {STATUS_CONFIG[currentStatus as IdeaStatus]?.label ?? currentStatus}
              <button className="cursor-pointer" onClick={() => updateParams({ status: "" })}>
                <X className="h-3 w-3" />
              </button>
            </Badge>
          )}
        </div>
      )}

      {/* Ideas list */}
      {filteredIdeas.length === 0 ? (
        <div className="py-16 text-center">
          <p className="text-lg text-muted-foreground">
            {currentSearch || currentTag || currentStatus || currentView !== "all"
              ? currentView === "mine"
                ? "You haven't shared any ideas yet."
                : currentView === "collaborating"
                  ? "You're not collaborating on any ideas yet."
                  : "No ideas match your filters."
              : "No ideas yet. Be the first to share one!"}
          </p>
          {currentView === "mine" && (
            <Link href="/ideas/new">
              <Button variant="outline" size="sm" className="mt-4">
                Share an idea
              </Button>
            </Link>
          )}
          {currentView === "collaborating" && (
            <Button
              variant="outline"
              size="sm"
              className="mt-4"
              onClick={() => updateParams({ view: "" })}
            >
              Browse ideas
            </Button>
          )}
          {currentView === "all" && !currentSearch && !currentTag && !currentStatus && (
            <Link href="/ideas/new">
              <Button variant="outline" size="sm" className="mt-4">
                Share the first idea
              </Button>
            </Link>
          )}
          {(currentSearch || currentTag || currentStatus) && currentView === "all" && (
            <Button
              variant="outline"
              size="sm"
              className="mt-4"
              onClick={() => {
                clearSearch();
                updateParams({ tag: "", status: "", q: "" });
              }}
            >
              Clear filters
            </Button>
          )}
        </div>
      ) : (
        <div className="space-y-4">
          {filteredIdeas.map((idea) => (
            <IdeaCard
              key={idea.id}
              idea={idea}
              hasVoted={userVotes.includes(idea.id)}
              taskCount={taskCounts[idea.id]}
              latestDiscussion={latestDiscussions?.[idea.id]}
            />
          ))}
        </div>
      )}

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="mt-8 flex items-center justify-center gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={currentPage <= 1}
            onClick={() => updateParams({ page: String(currentPage - 1) })}
          >
            <ChevronLeft className="h-4 w-4" />
            Previous
          </Button>
          <span className="text-sm text-muted-foreground">
            Page {currentPage} of {totalPages}
          </span>
          <Button
            variant="outline"
            size="sm"
            disabled={currentPage >= totalPages}
            onClick={() => updateParams({ page: String(currentPage + 1) })}
          >
            Next
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      )}
    </div>
  );
}
