"use client";

import { useEffect, useRef, useMemo } from "react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { useBotRoles } from "@/components/bot-roles-context";
import { getRoleColor } from "@/lib/agent-colors";
import { getInitials } from "@/lib/utils";
import type { User } from "@/types";

interface MentionAutocompleteProps {
  filteredMembers: User[];
  selectedIndex: number;
  onSelect: (user: User) => void;
}

export function MentionAutocomplete({
  filteredMembers,
  selectedIndex,
  onSelect,
}: MentionAutocompleteProps) {
  const botRoles = useBotRoles();
  const listRef = useRef<HTMLDivElement>(null);

  const { agents, members } = useMemo(() => {
    const agents: User[] = [];
    const members: User[] = [];
    for (const m of filteredMembers) {
      if (m.is_bot) {
        agents.push(m);
      } else {
        members.push(m);
      }
    }
    return { agents, members };
  }, [filteredMembers]);

  // Scroll selected item into view
  useEffect(() => {
    const list = listRef.current;
    if (!list) return;
    const items = list.querySelectorAll("[data-mention-item]");
    const selected = items[selectedIndex] as HTMLElement | undefined;
    selected?.scrollIntoView({ block: "nearest" });
  }, [selectedIndex]);

  if (filteredMembers.length === 0) {
    return (
      <div className="absolute bottom-full left-0 z-50 mb-1 w-64 rounded-lg border bg-popover p-2 shadow-md">
        <p className="text-center text-xs text-muted-foreground">
          No team members found
        </p>
      </div>
    );
  }

  // Flat index: agents first, then members
  let flatIndex = 0;

  function renderItem(user: User) {
    const idx = flatIndex++;
    const initials = getInitials(user.full_name);

    const role = user.is_bot ? botRoles?.[user.id] : undefined;
    const colors = user.is_bot ? getRoleColor(role) : null;

    return (
      <button
        key={user.id}
        type="button"
        data-mention-item
        className={`flex w-full items-center gap-2 rounded-md px-3 py-1.5 text-left text-sm transition-colors ${
          idx === selectedIndex
            ? "bg-accent text-accent-foreground"
            : "hover:bg-accent/50"
        }`}
        onMouseDown={(e) => {
          e.preventDefault();
          onSelect(user);
        }}
      >
        <Avatar className="h-5 w-5">
          <AvatarImage src={user.avatar_url ?? undefined} />
          <AvatarFallback className={`text-[9px] ${colors ? `${colors.avatarBg} ${colors.avatarText}` : ""}`}>
            {initials}
          </AvatarFallback>
        </Avatar>
        <div className="flex flex-col leading-tight">
          <span>{user.full_name ?? user.email}</span>
          {user.is_bot && botRoles?.[user.id] && (
            <span className="text-[11px] text-muted-foreground">{botRoles[user.id]}</span>
          )}
        </div>
      </button>
    );
  }

  return (
    <div className="absolute bottom-full left-0 z-50 mb-1 w-64 rounded-lg border bg-popover shadow-md">
      <div ref={listRef} className="max-h-48 overflow-y-auto p-1">
        {agents.length > 0 && (
          <>
            <div className="px-3 py-1 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
              Your Agents
            </div>
            {agents.map((agent) => renderItem(agent))}
          </>
        )}
        {members.length > 0 && (
          <>
            <div className={`px-3 py-1 text-[10px] font-medium uppercase tracking-wider text-muted-foreground ${agents.length > 0 ? "mt-1 border-t border-border pt-2" : ""}`}>
              Members
            </div>
            {members.map((member) => renderItem(member))}
          </>
        )}
      </div>
    </div>
  );
}
