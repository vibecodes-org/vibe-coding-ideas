"use client";

import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Search, X, ChevronLeft, ChevronRight, Users } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { MemberCard } from "./member-card";

export interface MemberWithCounts {
  id: string;
  full_name: string | null;
  email: string;
  avatar_url: string | null;
  bio: string | null;
  github_username: string | null;
  is_admin: boolean;
  created_at: string;
  idea_count: number;
  collab_count: number;
}

const SORT_OPTIONS = [
  { value: "newest", label: "Newest" },
  { value: "most_ideas", label: "Most Ideas" },
  { value: "most_collabs", label: "Most Collaborations" },
];

interface MemberDirectoryProps {
  members: MemberWithCounts[];
  currentSearch: string;
  currentSort: string;
  currentPage: number;
  totalPages: number;
  isAdmin: boolean;
  isSuperAdmin: boolean;
  currentUserId?: string;
}

export function MemberDirectory({
  members,
  currentSearch,
  currentSort,
  currentPage,
  totalPages,
  isAdmin,
  isSuperAdmin,
  currentUserId,
}: MemberDirectoryProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [searchInput, setSearchInput] = useState(currentSearch);

  const updateParams = (updates: Record<string, string>) => {
    const params = new URLSearchParams(searchParams.toString());
    Object.entries(updates).forEach(([key, value]) => {
      if (value) {
        params.set(key, value);
      } else {
        params.delete(key);
      }
    });
    if (!("page" in updates)) {
      params.delete("page");
    }
    router.push(`/members?${params.toString()}`);
  };

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    updateParams({ q: searchInput });
  };

  const clearSearch = () => {
    setSearchInput("");
    updateParams({ q: "" });
  };

  return (
    <div>
      {/* Header */}
      <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
        <h1 className="text-2xl font-bold">Members</h1>
        <Select
          value={currentSort}
          onValueChange={(v) => updateParams({ sort: v })}
        >
          <SelectTrigger className="w-[180px]" aria-label="Sort members">
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

      {/* Search bar */}
      <form onSubmit={handleSearch} className="mb-6 flex gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder="Search members..."
            className="pl-9"
            aria-label="Search members"
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
        <Button type="submit" variant="secondary">
          Search
        </Button>
      </form>

      {/* Active search pill */}
      {currentSearch && (
        <div className="mb-4 flex items-center gap-2 text-sm text-muted-foreground">
          <span>Showing results for:</span>
          <span className="inline-flex items-center gap-1 rounded-md bg-secondary px-2 py-0.5 text-secondary-foreground">
            &quot;{currentSearch}&quot;
            <button className="cursor-pointer" onClick={clearSearch}>
              <X className="h-3 w-3" />
            </button>
          </span>
        </div>
      )}

      {/* Members grid */}
      {members.length === 0 ? (
        <div className="py-16 text-center" aria-live="polite">
          <Users className="mx-auto mb-3 h-12 w-12 text-muted-foreground/50" />
          <p className="text-lg text-muted-foreground">No members found</p>
          {currentSearch && (
            <p className="mt-1 text-sm text-muted-foreground">
              Try a different search term
            </p>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
          {members.map((member) => (
            <MemberCard
              key={member.id}
              member={member}
              isAdmin={isAdmin}
              isSuperAdmin={isSuperAdmin}
              isCurrentUser={member.id === currentUserId}
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
            aria-label="Previous page"
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
            aria-label="Next page"
          >
            Next
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      )}
    </div>
  );
}
