"use client";

import { useCallback, useEffect, useState, useTransition } from "react";
import Link from "next/link";
import {
  Bell,
  MessageSquare,
  ChevronUp,
  Users,
  Check,
  Trash2,
  ArrowRightLeft,
  AtSign,
  UserPlus,
  UserCheck,
} from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { createClient } from "@/lib/supabase/client";
import { getRoleColor } from "@/lib/agent-colors";
import { markAllNotificationsRead, markNotificationsRead } from "@/actions/notifications";
import { RequestActionButtons } from "@/components/layout/request-action-buttons";
import { formatRelativeTime, getInitials } from "@/lib/utils";
import type { NotificationWithDetails } from "@/types";

const iconMap = {
  comment: MessageSquare,
  vote: ChevronUp,
  collaborator: Users,
  user_deleted: Trash2,
  status_change: ArrowRightLeft,
  task_mention: AtSign,
  comment_mention: AtSign,
  collaboration_request: UserPlus,
  collaboration_response: UserCheck,
  discussion: MessageSquare,
  discussion_reply: MessageSquare,
  discussion_mention: AtSign,
};

const messageMap = {
  comment: "commented on",
  vote: "voted on",
  collaborator: "joined as collaborator on",
  user_deleted: "removed an idea you were collaborating on",
  status_change: "updated the status of",
  task_mention: "mentioned you in a task on",
  comment_mention: "mentioned you in a comment on",
  collaboration_request: "requested to collaborate on",
  collaboration_response: "responded to your collaboration request on",
  discussion: "started a discussion on",
  discussion_reply: "replied to a discussion on",
  discussion_mention: "mentioned you in a discussion on",
};

const agentMessageMap: Record<string, string> = {
  task_mention: "mentioned your agent in a task on",
  comment_mention: "mentioned your agent in a comment on",
  discussion_mention: "mentioned your agent in a discussion on",
  discussion_reply: "replied to your agent in a discussion on",
};

type AgentNotification = NotificationWithDetails & {
  botName: string;
  botRole: string | null;
  botAvatarUrl: string | null;
};

export function NotificationBell() {
  const [notifications, setNotifications] = useState<NotificationWithDetails[]>([]);
  const [agentNotifications, setAgentNotifications] = useState<AgentNotification[]>([]);
  const [botIds, setBotIds] = useState<string[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [agentUnreadCount, setAgentUnreadCount] = useState(0);
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();

  const fetchNotifications = useCallback(async () => {
    const supabase = createClient();
    const { data } = await supabase
      .from("notifications")
      .select(
        "*, actor:users!notifications_actor_id_fkey(id, full_name, avatar_url, email, bio, github_username, created_at, updated_at), idea:ideas!notifications_idea_id_fkey(id, title)"
      )
      .order("created_at", { ascending: false })
      .limit(20);

    if (data) {
      setNotifications(data as unknown as NotificationWithDetails[]);
      setUnreadCount(data.filter((n) => !n.read).length);
    }
  }, []);

  const fetchAgentNotifications = useCallback(async (ids: string[]) => {
    if (ids.length === 0) return;
    const supabase = createClient();

    // Fetch bot names, roles, and avatars for display
    const { data: bots } = await supabase
      .from("bot_profiles")
      .select("id, name, role, avatar_url")
      .in("id", ids);
    const botInfoMap = new Map(
      bots?.map((b) => [b.id, { name: b.name, role: b.role, avatar_url: b.avatar_url }]) ?? []
    );

    const { data } = await supabase
      .from("notifications")
      .select(
        "*, actor:users!notifications_actor_id_fkey(id, full_name, avatar_url, email, bio, github_username, created_at, updated_at), idea:ideas!notifications_idea_id_fkey(id, title)"
      )
      .in("user_id", ids)
      .order("created_at", { ascending: false })
      .limit(20);

    if (data) {
      const mapped = (data as unknown as NotificationWithDetails[]).map((n) => {
        const bot = botInfoMap.get(n.user_id);
        return {
          ...n,
          botName: bot?.name ?? "Agent",
          botRole: bot?.role ?? null,
          botAvatarUrl: bot?.avatar_url ?? null,
        };
      });
      setAgentNotifications(mapped);
      setAgentUnreadCount(mapped.filter((n) => !n.read).length);
    }
  }, []);

  useEffect(() => {
    const init = async () => {
      const supabase = createClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      // Fetch user's bots
      const { data: bots } = await supabase
        .from("bot_profiles")
        .select("id")
        .eq("owner_id", user.id);
      const ids = bots?.map((b) => b.id) ?? [];
      setBotIds(ids);

      await fetchNotifications();
      if (ids.length > 0) {
        await fetchAgentNotifications(ids);
      }
    };
    init();

    const supabase = createClient();
    const channel = supabase
      .channel("notifications-bell")
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "notifications" }, () => {
        fetchNotifications();
        if (botIds.length > 0) {
          fetchAgentNotifications(botIds);
        }
      })
      .subscribe();

    return () => {
      channel.unsubscribe();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Re-subscribe when botIds change so realtime picks up agent notifications
  useEffect(() => {
    if (botIds.length === 0) return;
    const supabase = createClient();
    const channel = supabase
      .channel("notifications-bell-agents")
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "notifications" }, () => {
        fetchNotifications();
        fetchAgentNotifications(botIds);
      })
      .subscribe();

    return () => {
      channel.unsubscribe();
    };
  }, [botIds, fetchNotifications, fetchAgentNotifications]);

  const handleMarkAllRead = () => {
    startTransition(async () => {
      await markAllNotificationsRead();
      setNotifications((prev) => prev.map((n) => ({ ...n, read: true })));
      setUnreadCount(0);
    });
  };

  const handleRequestHandled = (notificationId: string) => {
    setNotifications((prev) => prev.map((n) => (n.id === notificationId ? { ...n, read: true } : n)));
    setUnreadCount((prev) => Math.max(0, prev - 1));
    markNotificationsRead([notificationId]);
  };

  const totalUnread = unreadCount + agentUnreadCount;
  const hasBots = botIds.length > 0;

  const renderNotificationItem = (
    notification: NotificationWithDetails,
    options: { isAgent?: boolean; botName?: string; botRole?: string | null; botAvatarUrl?: string | null } = {}
  ) => {
    const { isAgent, botName, botRole, botAvatarUrl } = options;
    const message = isAgent
      ? (agentMessageMap[notification.type] ?? messageMap[notification.type as keyof typeof messageMap] ?? "interacted with")
      : (messageMap[notification.type as keyof typeof messageMap] ?? "interacted with");

    // For agent notifications, show the bot avatar with role-based colors
    // For regular notifications, show the actor's avatar
    const agentColors = isAgent ? getRoleColor(botRole) : null;
    const avatarUrl = isAgent ? botAvatarUrl : notification.actor.avatar_url;
    const avatarName = isAgent ? (botName ?? "Agent") : (notification.actor.full_name ?? "?");
    const initials = getInitials(avatarName);

    const content = (
      <>
        <Avatar className="mt-0.5 h-7 w-7 shrink-0">
          <AvatarImage src={avatarUrl ?? undefined} />
          <AvatarFallback className={`text-[10px] ${agentColors ? `${agentColors.avatarBg} ${agentColors.avatarText}` : ""}`}>
            {initials}
          </AvatarFallback>
        </Avatar>
        <div className="flex-1 min-w-0">
          <p className="text-sm">
            {isAgent && botName && (
              <span className={`mr-1 inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-semibold ${agentColors ? agentColors.badge : "bg-muted text-muted-foreground"}`}>
                {botName}
              </span>
            )}
            <span className="font-medium">{notification.actor.full_name ?? "Someone"}</span>{" "}
            {message}
            {notification.idea && (
              <>
                {" "}
                <span className="font-medium truncate">{notification.idea.title}</span>
              </>
            )}
          </p>
          {!isAgent && notification.type === "collaboration_request" &&
            notification.collaboration_request_id &&
            notification.idea_id &&
            !notification.read && (
              <RequestActionButtons
                notificationId={notification.id}
                requestId={notification.collaboration_request_id}
                ideaId={notification.idea_id}
                onHandled={handleRequestHandled}
              />
            )}
          <p className="text-xs text-muted-foreground">{formatRelativeTime(notification.created_at)}</p>
        </div>
        {!notification.read && <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-primary" />}
      </>
    );

    const className = `flex items-start gap-3 px-3 py-2.5 transition-colors hover:bg-muted ${
      !notification.read ? "bg-primary/5" : ""
    }`;

    if (notification.idea_id) {
      let href: string;
      if (notification.task_id) {
        href = `/ideas/${notification.idea_id}/board?taskId=${notification.task_id}`;
      } else if (notification.discussion_id) {
        href = `/ideas/${notification.idea_id}/discussions/${notification.discussion_id}`;
      } else {
        href = `/ideas/${notification.idea_id}`;
      }
      return (
        <Link
          key={notification.id}
          href={href}
          onClick={() => {
            setOpen(false);
            // Agent notifications are read-only — don't mark as read
            if (!isAgent && !notification.read) {
              setNotifications((prev) =>
                prev.map((n) => (n.id === notification.id ? { ...n, read: true } : n))
              );
              setUnreadCount((prev) => Math.max(0, prev - 1));
              markNotificationsRead([notification.id]);
            }
          }}
          className={className}
        >
          {content}
        </Link>
      );
    }

    return (
      <div key={notification.id} className={className}>
        {content}
      </div>
    );
  };

  const renderNotificationList = (items: NotificationWithDetails[], isAgent: boolean) => {
    if (items.length === 0) {
      return (
        <div className="px-3 py-6 text-center text-sm text-muted-foreground">
          {isAgent ? "No agent notifications yet" : "No notifications yet"}
        </div>
      );
    }
    return items.map((n) => {
      const agentN = isAgent ? (n as AgentNotification) : undefined;
      return renderNotificationItem(n, {
        isAgent,
        botName: agentN?.botName,
        botRole: agentN?.botRole,
        botAvatarUrl: agentN?.botAvatarUrl,
      });
    });
  };

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <Button data-testid="notification-bell" variant="ghost" size="icon" className="relative">
          <Bell className="h-5 w-5" />
          {totalUnread > 0 && (
            <span className="absolute -top-0.5 -right-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-primary text-[10px] font-bold text-primary-foreground">
              {totalUnread > 9 ? "9+" : totalUnread}
            </span>
          )}
          <span className="sr-only">Notifications</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-[calc(100vw-2rem)] sm:w-80 max-w-80">
        {hasBots ? (
          <Tabs defaultValue="mine" className="gap-0">
            <div className="flex items-center justify-between border-b border-border px-3 py-2">
              <span className="text-sm font-semibold">Notifications</span>
              {/* Mark all read only shown on Mine tab — handled via tab content */}
            </div>
            <TabsList className="w-full rounded-none border-b border-border" variant="line">
              <TabsTrigger value="mine" className="flex-1 text-xs gap-1">
                Mine
                {unreadCount > 0 && (
                  <span className="ml-0.5 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-bold text-primary-foreground">
                    {unreadCount > 9 ? "9+" : unreadCount}
                  </span>
                )}
              </TabsTrigger>
              <TabsTrigger value="agents" className="flex-1 text-xs gap-1">
                Agents
                {agentUnreadCount > 0 && (
                  <span className="ml-0.5 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-bold text-primary-foreground">
                    {agentUnreadCount > 9 ? "9+" : agentUnreadCount}
                  </span>
                )}
              </TabsTrigger>
            </TabsList>
            <TabsContent value="mine" className="mt-0">
              {unreadCount > 0 && (
                <div className="flex justify-end border-b border-border px-3 py-1.5">
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 gap-1 text-xs"
                    onClick={handleMarkAllRead}
                    disabled={isPending}
                  >
                    <Check className="h-3 w-3" />
                    Mark all read
                  </Button>
                </div>
              )}
              <div className="max-h-72 overflow-y-auto">
                {renderNotificationList(notifications, false)}
              </div>
            </TabsContent>
            <TabsContent value="agents" className="mt-0">
              <div className="max-h-72 overflow-y-auto">
                {renderNotificationList(agentNotifications, true)}
              </div>
            </TabsContent>
          </Tabs>
        ) : (
          <>
            <div className="flex items-center justify-between border-b border-border px-3 py-2">
              <span className="text-sm font-semibold">Notifications</span>
              {unreadCount > 0 && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 gap-1 text-xs"
                  onClick={handleMarkAllRead}
                  disabled={isPending}
                >
                  <Check className="h-3 w-3" />
                  Mark all read
                </Button>
              )}
            </div>
            <div className="max-h-80 overflow-y-auto">
              {renderNotificationList(notifications, false)}
            </div>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
