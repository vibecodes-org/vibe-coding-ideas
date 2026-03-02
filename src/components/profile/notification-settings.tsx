"use client";

import { useState, useTransition } from "react";
import { Bell, Mail, Settings } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { updateNotificationPreferences } from "@/actions/notifications";
import type { NotificationPreferences } from "@/types";

interface NotificationSettingsProps {
  preferences: NotificationPreferences;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}

const inAppLabels: Record<string, string> = {
  comments: "Comments on your ideas",
  votes: "Votes on your ideas",
  collaborators: "New collaborators",
  status_changes: "Idea status updates",
  task_mentions: "Task mentions",
  comment_mentions: "Comment mentions",
  discussions: "New discussions & replies",
  discussion_mentions: "Discussion mentions",
  collaboration_requests: "Collaboration requests",
  collaboration_responses: "Collaboration request responses",
};

export function NotificationSettings({
  preferences,
  open: controlledOpen,
  onOpenChange: controlledOnOpenChange,
}: NotificationSettingsProps) {
  const [internalOpen, setInternalOpen] = useState(false);
  const isControlled = controlledOpen !== undefined;
  const open = isControlled ? controlledOpen : internalOpen;
  const setOpen = isControlled ? controlledOnOpenChange! : setInternalOpen;
  const [prefs, setPrefs] = useState<NotificationPreferences>({
    ...preferences,
    // Ensure email_notifications has a default for users who haven't been backfilled yet
    email_notifications: preferences.email_notifications ?? true,
  });
  const [isPending, startTransition] = useTransition();

  function toggle(key: keyof NotificationPreferences) {
    setPrefs((prev) => ({ ...prev, [key]: !prev[key] }));
  }

  function handleSave() {
    startTransition(async () => {
      try {
        await updateNotificationPreferences(prefs);
        setOpen(false);
        toast.success("Notification preferences updated");
      } catch {
        toast.error("Failed to update preferences");
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      {!isControlled && (
        <DialogTrigger asChild>
          <Button variant="outline" size="sm" className="gap-2">
            <Settings className="h-4 w-4" />
            Notifications
          </Button>
        </DialogTrigger>
      )}
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Bell className="h-5 w-5" />
            Notification Preferences
          </DialogTitle>
          <DialogDescription>Choose which notifications you want to receive.</DialogDescription>
        </DialogHeader>
        <div className="space-y-5 py-2">
          {/* In-app notification toggles */}
          <div className="space-y-4">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              In-app notifications
            </p>
            {(Object.keys(inAppLabels) as (keyof typeof inAppLabels)[]).map(
              (key) => (
                <div key={key} className="flex items-center justify-between">
                  <span className="text-sm">{inAppLabels[key]}</span>
                  <Switch
                    checked={prefs[key as keyof NotificationPreferences] as boolean}
                    onCheckedChange={() => toggle(key as keyof NotificationPreferences)}
                  />
                </div>
              )
            )}
          </div>

          {/* Divider */}
          <div className="border-t border-border" />

          {/* Email notifications toggle */}
          <div className="space-y-2">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Email notifications
            </p>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Mail className="h-4 w-4 text-muted-foreground" />
                <span className="text-sm">Send me email notifications</span>
              </div>
              <Switch
                checked={prefs.email_notifications}
                onCheckedChange={() => toggle("email_notifications")}
              />
            </div>
            <p className="text-xs text-muted-foreground">
              Get emailed for comments, collaborators, status changes, and mentions.
              Votes are in-app only.
            </p>
          </div>
        </div>
        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => {
              setPrefs({
                ...preferences,
                email_notifications: preferences.email_notifications ?? true,
              });
              setOpen(false);
            }}
            disabled={isPending}
          >
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={isPending}>
            {isPending ? "Saving..." : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
