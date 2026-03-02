"use client";

import { Bot, Pencil } from "lucide-react";
import { toast } from "sonner";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { CreateBotDialog } from "./create-bot-dialog";
import { EditBotDialog } from "./edit-bot-dialog";
import { updateBot } from "@/actions/bots";
import { getInitials } from "@/lib/utils";
import type { BotProfile } from "@/types";

interface BotManagementProps {
  bots: BotProfile[];
}

export function BotManagement({ bots }: BotManagementProps) {
  async function handleToggleActive(bot: BotProfile) {
    try {
      await updateBot(bot.id, { is_active: !bot.is_active });
    } catch {
      toast.error("Failed to update agent");
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Bot className="h-5 w-5" />
          <h2 className="text-lg font-semibold">My Agents</h2>
        </div>
        <CreateBotDialog />
      </div>

      {bots.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No agents yet. Create one to give Claude Code sessions distinct identities.
        </p>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {bots.map((bot) => {
            const initials = getInitials(bot.name);

            return (
              <div
                key={bot.id}
                className={`flex items-start gap-3 overflow-hidden rounded-lg border p-3 ${
                  bot.is_active ? "border-border" : "border-border/50 opacity-60"
                }`}
              >
                <Avatar className="h-10 w-10 shrink-0">
                  <AvatarImage src={bot.avatar_url ?? undefined} />
                  <AvatarFallback className="bg-primary/10 text-xs">
                    {initials}
                  </AvatarFallback>
                </Avatar>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="font-medium text-sm truncate">
                      {bot.name}
                    </span>
                    {bot.role && (
                      <Badge variant="secondary" className="text-[10px] shrink-0 max-w-[120px] truncate">
                        {bot.role}
                      </Badge>
                    )}
                  </div>
                  {bot.system_prompt && (
                    <p className="mt-0.5 text-xs text-muted-foreground line-clamp-2">
                      {bot.system_prompt}
                    </p>
                  )}
                  <div className="mt-2 flex items-center gap-2">
                    <Switch
                      checked={bot.is_active}
                      onCheckedChange={() => handleToggleActive(bot)}
                      className="scale-75"
                    />
                    <span className="text-[10px] text-muted-foreground">
                      {bot.is_active ? "Active" : "Inactive"}
                    </span>
                    <EditBotDialog bot={bot}>
                      <Button variant="ghost" size="sm" className="ml-auto h-6 gap-1 text-xs">
                        <Pencil className="h-3 w-3" />
                        Edit
                      </Button>
                    </EditBotDialog>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
