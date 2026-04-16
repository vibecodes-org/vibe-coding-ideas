"use client";

import { useState } from "react";
import { Bell, Columns, Key, Settings, Terminal } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { NotificationSettings } from "./notification-settings";
import { BoardColumnSettings } from "./board-column-settings";
import { ApiKeySettings } from "./api-key-settings";
import { McpApiKeys } from "./mcp-api-keys";
import type { NotificationPreferences } from "@/types";

interface ProfileSettingsMenuProps {
  preferences: NotificationPreferences;
  columns: { title: string; is_done_column: boolean }[] | null;
  hasApiKey: boolean;
}

export function ProfileSettingsMenu({
  preferences,
  columns,
  hasApiKey,
}: ProfileSettingsMenuProps) {
  const [showNotifications, setShowNotifications] = useState(false);
  const [showColumns, setShowColumns] = useState(false);
  const [showApiKey, setShowApiKey] = useState(false);
  const [showMcpKeys, setShowMcpKeys] = useState(false);

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" size="sm" className="gap-2">
            <Settings className="h-4 w-4" />
            Settings
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onClick={() => setShowNotifications(true)}>
            <Bell className="mr-2 h-4 w-4" />
            Notifications
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => setShowColumns(true)}>
            <Columns className="mr-2 h-4 w-4" />
            Board Columns
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => setShowApiKey(true)}>
            <Key className="mr-2 h-4 w-4" />
            API Key
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => setShowMcpKeys(true)}>
            <Terminal className="mr-2 h-4 w-4" />
            MCP API Keys
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      {/* Render dialogs without triggers — controlled via open state */}
      <NotificationSettings
        preferences={preferences}
        open={showNotifications}
        onOpenChange={setShowNotifications}
      />
      <BoardColumnSettings
        columns={columns}
        open={showColumns}
        onOpenChange={setShowColumns}
      />
      <ApiKeySettings
        hasKey={hasApiKey}
        open={showApiKey}
        onOpenChange={setShowApiKey}
      />
      <McpApiKeys
        open={showMcpKeys}
        onOpenChange={setShowMcpKeys}
      />
    </>
  );
}
