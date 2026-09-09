import { SettingsRow } from "@/components/profile/settings-row";
import { Bot, Github, Key, Bell, Columns3, Cpu, Terminal, UserRound } from "lucide-react";
import { requireAuth } from "@/lib/auth";
import { EditProfileDialog } from "@/components/profile/edit-profile-dialog";
import { NotificationSettings } from "@/components/profile/notification-settings";
import { ApiKeySettings } from "@/components/profile/api-key-settings";
import { ModelTierSettings } from "@/components/profile/model-tier-settings";
import { normalizeUserModelTierMap } from "@/lib/platform-model-defaults";
import { BoardColumnSettings } from "@/components/profile/board-column-settings";
import { McpApiKeys } from "@/components/profile/mcp-api-keys";
import { GithubConnection } from "@/components/profile/github-connection";
import type { Metadata } from "next";
import type { User } from "@/types";

export const metadata: Metadata = {
  title: "Settings",
};

type OwnProfileSettings = Pick<
  User,
  | "id"
  | "full_name"
  | "avatar_url"
  | "bio"
  | "github_username"
  | "contact_info"
  | "notification_preferences"
  | "default_board_columns"
  | "has_anthropic_key"
  | "model_tier_map"
  | "terminal_model"
  | "terminal_codex_model"
  | "terminal_codex_effort"
  | "terminal_auto_accept"
>;

export default async function SettingsPage() {
  const { user, supabase } = await requireAuth();

  const { data: settings } = await supabase
    .from("users")
    .select(
      "id, full_name, avatar_url, bio, github_username, contact_info, notification_preferences, default_board_columns, has_anthropic_key, model_tier_map, terminal_model, terminal_codex_model, terminal_codex_effort, terminal_auto_accept"
    )
    .eq("id", user.id)
    .single();

  const ownSettings = settings as OwnProfileSettings | null;

  return (
    <div className="mx-auto max-w-2xl px-4 py-8">
      <h1 className="text-2xl font-bold">Settings</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Manage your profile, notifications, and integrations.
      </p>

      <div className="mt-6 space-y-2">
        {ownSettings && (
          <SettingsRow
            icon={UserRound}
            title="Profile"
            description="Name, avatar, bio, and contact info."
            action={<EditProfileDialog user={ownSettings} />}
          />
        )}
        {ownSettings && (
          <SettingsRow
            icon={Bell}
            title="Notifications"
            description="Choose which notifications you want to receive."
            action={<NotificationSettings preferences={ownSettings.notification_preferences} />}
          />
        )}
        {ownSettings && (
          <SettingsRow
            icon={Columns3}
            title="Board Defaults"
            description="Default columns for new boards."
            action={<BoardColumnSettings columns={ownSettings.default_board_columns} />}
          />
        )}
        {ownSettings && (
          <SettingsRow
            icon={Key}
            title="AI API Key"
            description="Bring your own Anthropic key, or use platform credits."
            action={<ApiKeySettings hasKey={!!ownSettings.has_anthropic_key} />}
          />
        )}
        {ownSettings && (
          <SettingsRow
            icon={Cpu}
            title="Model Tiers"
            description="Which Claude model each tier and the in-app terminal use."
            action={
              <ModelTierSettings
                // model_tier_map's stored type is agent-aware now (Codex
                // model-tier task, FR-2 — see ModelTierMapStored in
                // src/types/database.ts). Normalized server-side so a legacy
                // flat row (or malformed/empty value) upgrades transparently
                // before ModelTierSettings ever sees it (AC-2 backward compat).
                agentAwareMap={normalizeUserModelTierMap(ownSettings.model_tier_map)}
                terminalModel={ownSettings.terminal_model}
                terminalCodexModel={ownSettings.terminal_codex_model}
                terminalCodexEffort={ownSettings.terminal_codex_effort}
                terminalAutoAccept={ownSettings.terminal_auto_accept}
              />
            }
          />
        )}
        <SettingsRow
          icon={Terminal}
          title="MCP API Keys"
          description="Keys for connecting external MCP clients to VibeCodes."
          action={<McpApiKeys />}
        />
        <SettingsRow
          icon={Github}
          title="GitHub"
          description="Connect GitHub to browse and create repos from ideas."
          action={<GithubConnection />}
        />
        <SettingsRow
          icon={Bot}
          title="Manage agents"
          description="View and configure the agents on your boards."
          href="/agents"
        />
      </div>
    </div>
  );
}
