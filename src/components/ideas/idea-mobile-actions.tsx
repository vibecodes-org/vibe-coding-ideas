"use client";

import Link from "next/link";
import { Pencil, MoreHorizontal } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { EnhanceIdeaButton } from "@/components/ideas/enhance-idea-button";
import { DeleteIdeaButton } from "@/components/ideas/delete-idea-button";
import type { BotProfile } from "@/types";

interface IdeaMobileActionsProps {
  ideaId: string;
  ideaTitle: string;
  ideaDescription: string;
  isAuthor: boolean;
  canDelete: boolean;
  canUseAi: boolean;
  userBots: BotProfile[];
}

export function IdeaMobileActions({
  ideaId,
  ideaTitle,
  ideaDescription,
  isAuthor,
  canDelete,
  canUseAi,
  userBots,
}: IdeaMobileActionsProps) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm" className="gap-2 sm:hidden">
          <MoreHorizontal className="h-4 w-4" />
          More
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        {isAuthor && (
          <DropdownMenuItem asChild>
            <Link href={`/ideas/${ideaId}/edit`} className="flex items-center gap-2">
              <Pencil className="h-4 w-4" />
              Edit
            </Link>
          </DropdownMenuItem>
        )}
        {isAuthor && (
          <DropdownMenuItem onSelect={(e) => e.preventDefault()} className="p-0">
            <EnhanceIdeaButton
              ideaId={ideaId}
              ideaTitle={ideaTitle}
              currentDescription={ideaDescription}
              bots={userBots}
              disabled={!canUseAi}
              variant="dropdown"
            />
          </DropdownMenuItem>
        )}
        {canDelete && (
          <DropdownMenuItem onSelect={(e) => e.preventDefault()} className="p-0">
            <DeleteIdeaButton ideaId={ideaId} variant="dropdown" />
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
