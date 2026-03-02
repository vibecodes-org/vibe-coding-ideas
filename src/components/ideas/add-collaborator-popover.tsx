"use client";

import { useState, useEffect, useRef, useTransition, useCallback } from "react";
import { UserPlus, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Input } from "@/components/ui/input";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { createClient } from "@/lib/supabase/client";
import { addCollaborator } from "@/actions/collaborators";
import { getInitials } from "@/lib/utils";
import type { User } from "@/types";

interface AddCollaboratorPopoverProps {
  ideaId: string;
  authorId: string;
  existingCollaboratorIds: string[];
}

export function AddCollaboratorPopover({
  ideaId,
  authorId,
  existingCollaboratorIds,
}: AddCollaboratorPopoverProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<User[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [addedIds, setAddedIds] = useState<string[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const supabase = createClient();

  // Reset state when popover closes
  useEffect(() => {
    if (!open) {
      setQuery("");
      setResults([]);
      setAddedIds([]);
    }
  }, [open]);

  // Debounced search
  useEffect(() => {
    if (!query.trim()) {
      setResults([]);
      return;
    }

    const timer = setTimeout(async () => {
      setIsSearching(true);
      const excludeIds = [authorId, ...existingCollaboratorIds, ...addedIds];
      const searchTerm = `%${query.trim().replace(/^@/, "")}%`;

      const { data } = await supabase
        .from("users")
        .select("*")
        .or(`full_name.ilike.${searchTerm},email.ilike.${searchTerm}`)
        .not("id", "in", `(${excludeIds.join(",")})`)
        .eq("is_bot", false)
        .limit(5);

      setResults(data ?? []);
      setSelectedIndex(0);
      setIsSearching(false);
    }, 300);

    return () => clearTimeout(timer);
  }, [query, authorId, existingCollaboratorIds, addedIds, supabase]);

  const handleSelect = useCallback((user: User) => {
    setAddedIds((prev) => [...prev, user.id]);
    setResults((prev) => prev.filter((u) => u.id !== user.id));
    startTransition(async () => {
      await addCollaborator(ideaId, user.id);
    });
  }, [ideaId]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (results.length === 0) return;

    if (e.key === "ArrowDown") {
      e.preventDefault();
      setSelectedIndex((prev) =>
        prev < results.length - 1 ? prev + 1 : 0
      );
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSelectedIndex((prev) =>
        prev > 0 ? prev - 1 : results.length - 1
      );
    } else if (e.key === "Enter") {
      e.preventDefault();
      handleSelect(results[selectedIndex]);
    }
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" className="gap-1.5">
          <UserPlus className="h-3.5 w-3.5" />
          Add
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-72 p-3" align="start">
        <Input
          ref={inputRef}
          placeholder="Search by name or email..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={handleKeyDown}
          className="mb-2"
          autoFocus
        />
        <div className="max-h-48 overflow-y-auto">
          {isSearching && (
            <div className="flex items-center justify-center py-3 text-sm text-muted-foreground">
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Searching...
            </div>
          )}
          {!isSearching && query.trim() && results.length === 0 && (
            <p className="py-3 text-center text-sm text-muted-foreground">
              No users found
            </p>
          )}
          {results.map((user, i) => {
            const initials = getInitials(user.full_name);
            return (
              <button
                key={user.id}
                onClick={() => handleSelect(user)}
                disabled={isPending}
                className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm disabled:opacity-50 ${
                  i === selectedIndex
                    ? "bg-accent text-accent-foreground"
                    : "hover:bg-accent"
                }`}
              >
                <Avatar className="h-6 w-6">
                  <AvatarImage src={user.avatar_url ?? undefined} />
                  <AvatarFallback className="text-[10px]">
                    {initials}
                  </AvatarFallback>
                </Avatar>
                <div className="min-w-0 flex-1 text-left">
                  <p className="truncate font-medium">
                    {user.full_name ?? "Anonymous"}
                  </p>
                  {user.email && (
                    <p className="truncate text-xs text-muted-foreground">
                      {user.email}
                    </p>
                  )}
                </div>
              </button>
            );
          })}
        </div>
      </PopoverContent>
    </Popover>
  );
}
