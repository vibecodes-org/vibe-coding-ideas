import Link from "next/link";
import { Bot, Github, Key, Bell, Columns3, Cpu, Terminal, UserRound, ChevronRight } from "lucide-react";
import { requireAuth } from "@/lib/auth";
import { EditProfileDialog } from "@/components/profile/edit-profile-dialog";
import { NotificationSettings } from "@/components/profile/notification-settings";
import { ApiKeySettings } from "@/components/profile/api-key-settings";
import { ModelTierSettings } from "@/components/profile/model-tier-settings";
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
  | "terminal_auto_accept"
>;

/** One row in the settings list: an icon, a label + short description, and the
 *  actual working control on the right (the existing dialog trigger button, or
 *  a plain link for `href`-only rows like Manage agents).
 *  Exported for unit testing — this is a page.tsx, but the helper itself has
 *  no server-only dependencies. */
export function SettingsRow({
  icon: Icon,
  title,
  description,
  action,
  href,
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  description: string;
  action?: React.ReactNode;
  href?: string;
}) {
  const body = (
    <div className="flex items-center justify-between gap-4 rounded-lg border border-border p-4">
      <div className="flex items-start gap-3">
        <Icon className="mt-0.5 h-5 w-5 shrink-0 text-muted-foreground" />
        <div>
          <p className="font-medium">{title}</p>
          <p className="text-sm text-muted-foreground">{description}</p>
        </div>
      </div>
      {action}
      {href && <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />}
    </div>
  );

  if (href) {
    return (
      <Link href={href} className="block transition-colors hover:bg-accent/50 rounded-lg">
        {body}
      </Link>
    );
  }

  return body;
}

export default async function SettingsPage() {
  const { user, supabase } = await requireAuth();

  const { data: settings } = await supabase
    .from("users")
    .select(
      "id, full_name, avatar_url, bio, github_username, contact_info, notification_preferences, default_board_columns, has_anthropic_key, model_tier_map, terminal_model, terminal_auto_accept"
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
                map={ownSettings.model_tier_map}
                terminalModel={ownSettings.terminal_model}
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
