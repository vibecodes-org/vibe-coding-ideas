export const dynamic = "force-dynamic";

import { createClient } from "@supabase/supabase-js";
import { buildEmailHtml } from "@/lib/email-template";
import type { Database } from "@/types/database";

type NotificationType =
  Database["public"]["Enums"]["notification_type"];

// Notification types that warrant an email (high-signal only)
const EMAIL_WORTHY_TYPES: NotificationType[] = [
  "comment",
  "collaborator",
  "status_change",
  "task_mention",
  "comment_mention",
  "collaboration_request",
  "collaboration_response",
  "discussion",
  "discussion_reply",
  "discussion_mention",
];

function jsonResponse(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export async function POST(request: Request) {
  // Verify webhook secret
  const authHeader = request.headers.get("authorization");
  const expectedSecret = process.env.NOTIFICATION_WEBHOOK_SECRET;

  if (!expectedSecret) {
    console.error("NOTIFICATION_WEBHOOK_SECRET not configured");
    return jsonResponse({ error: "Server misconfigured" }, 500);
  }

  if (authHeader !== `Bearer ${expectedSecret}`) {
    return jsonResponse({ error: "Unauthorized" }, 401);
  }

  const resendApiKey = process.env.RESEND_API_KEY;
  if (!resendApiKey) {
    console.error("RESEND_API_KEY not configured");
    return jsonResponse({ error: "Server misconfigured" }, 500);
  }

  let payload: {
    record: {
      id: string;
      user_id: string;
      actor_id: string;
      type: NotificationType;
      idea_id: string | null;
      comment_id: string | null;
      task_id: string | null;
      discussion_id: string | null;
    };
  };

  try {
    payload = await request.json();
  } catch {
    return jsonResponse({ error: "Invalid JSON" }, 400);
  }

  const notification = payload.record;
  if (!notification?.type || !notification?.user_id) {
    return jsonResponse({ error: "Invalid payload" }, 400);
  }

  // Skip low-signal notification types
  if (!EMAIL_WORTHY_TYPES.includes(notification.type)) {
    return jsonResponse({ skipped: true, reason: "low-signal type" });
  }

  // Use service role to query user data (this runs outside auth context)
  const supabase = createClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );

  // Get recipient user
  const { data: recipient } = await supabase
    .from("users")
    .select("email, full_name, notification_preferences")
    .eq("id", notification.user_id)
    .maybeSingle();

  if (!recipient?.email) {
    return jsonResponse({ skipped: true, reason: "no recipient email" });
  }

  // Check email_notifications preference
  const prefs = recipient.notification_preferences as Record<string, boolean> | null;
  if (prefs?.email_notifications === false) {
    return jsonResponse({ skipped: true, reason: "email notifications disabled" });
  }

  // Don't send emails to bot users
  const { data: recipientFull } = await supabase
    .from("users")
    .select("is_bot")
    .eq("id", notification.user_id)
    .maybeSingle();

  if (recipientFull?.is_bot) {
    return jsonResponse({ skipped: true, reason: "bot user" });
  }

  // Get actor name
  const { data: actor } = await supabase
    .from("users")
    .select("full_name, email")
    .eq("id", notification.actor_id)
    .maybeSingle();

  const actorName = actor?.full_name || actor?.email || "Someone";

  // Get idea title if applicable
  let ideaTitle: string | null = null;
  if (notification.idea_id) {
    const { data: idea } = await supabase
      .from("ideas")
      .select("title")
      .eq("id", notification.idea_id)
      .maybeSingle();
    ideaTitle = idea?.title || null;
  }

  // Get task title if applicable
  let taskTitle: string | null = null;
  if (notification.task_id) {
    const { data: task } = await supabase
      .from("board_tasks")
      .select("title")
      .eq("id", notification.task_id)
      .maybeSingle();
    taskTitle = task?.title || null;
  }

  // Build email content based on notification type
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || "https://vibecodes.co.uk";
  const email = buildNotificationEmail(
    notification.type,
    actorName,
    ideaTitle,
    taskTitle,
    notification.idea_id,
    notification.discussion_id,
    appUrl,
  );

  if (!email) {
    return jsonResponse({ skipped: true, reason: "no email content" });
  }

  // Send via Resend
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${resendApiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: "VibeCodes <noreply@vibecodes.co.uk>",
        to: [recipient.email],
        subject: email.subject,
        html: email.html,
      }),
    });

    if (!res.ok) {
      const errorText = await res.text();
      console.error("Resend API error:", res.status, errorText);
      return jsonResponse(
        { error: "Email send failed", details: errorText },
        502,
      );
    }

    const result = await res.json();
    return jsonResponse({ sent: true, id: result.id });
  } catch (err) {
    console.error("Failed to send email:", err);
    return jsonResponse({ error: "Email send failed" }, 500);
  }
}

function buildNotificationEmail(
  type: NotificationType,
  actorName: string,
  ideaTitle: string | null,
  taskTitle: string | null,
  ideaId: string | null,
  discussionId: string | null,
  appUrl: string,
): { subject: string; html: string } | null {
  const ideaUrl = ideaId ? `${appUrl}/ideas/${ideaId}` : appUrl;
  const discussionUrl = ideaId && discussionId
    ? `${appUrl}/ideas/${ideaId}/discussions/${discussionId}`
    : ideaId ? `${appUrl}/ideas/${ideaId}/discussions` : appUrl;
  const ideaDisplay = ideaTitle
    ? `<strong style="color:#fafafa;">${escapeBody(ideaTitle)}</strong>`
    : "your idea";

  switch (type) {
    case "comment": {
      return {
        subject: `${actorName} commented on your idea`,
        html: buildEmailHtml({
          heading: "New comment on your idea",
          bodyHtml: `<p style="margin:0;">${escapeBody(actorName)} left a comment on ${ideaDisplay}.</p>`,
          ctaText: "View Comment",
          ctaUrl: ideaUrl,
          footerText: "You received this because someone commented on your idea.",
        }),
      };
    }

    case "collaborator": {
      return {
        subject: `${actorName} joined your idea`,
        html: buildEmailHtml({
          heading: "New collaborator",
          bodyHtml: `<p style="margin:0;">${escapeBody(actorName)} is now collaborating on ${ideaDisplay}.</p>`,
          ctaText: "View Idea",
          ctaUrl: ideaUrl,
          footerText: "You received this because of collaborator activity on your idea.",
        }),
      };
    }

    case "status_change": {
      return {
        subject: ideaTitle
          ? `Status updated: ${ideaTitle}`
          : "An idea you collaborate on was updated",
        html: buildEmailHtml({
          heading: "Idea status updated",
          bodyHtml: `<p style="margin:0;">The status of ${ideaDisplay} has been updated.</p>`,
          ctaText: "View Idea",
          ctaUrl: ideaUrl,
          footerText:
            "You received this because you collaborate on this idea.",
        }),
      };
    }

    case "task_mention": {
      const taskDisplay = taskTitle
        ? `<strong style="color:#fafafa;">${escapeBody(taskTitle)}</strong>`
        : "a task";
      return {
        subject: `${actorName} mentioned you in a task`,
        html: buildEmailHtml({
          heading: "You were mentioned",
          bodyHtml: `<p style="margin:0;">${escapeBody(actorName)} mentioned you in a comment on ${taskDisplay}${ideaTitle ? ` (${ideaDisplay})` : ""}.</p>`,
          ctaText: "View Task",
          ctaUrl: ideaId ? `${appUrl}/ideas/${ideaId}/board` : appUrl,
          footerText: "You received this because you were mentioned in a task comment.",
        }),
      };
    }

    case "comment_mention": {
      return {
        subject: `${actorName} mentioned you in a comment`,
        html: buildEmailHtml({
          heading: "You were mentioned",
          bodyHtml: `<p style="margin:0;">${escapeBody(actorName)} mentioned you in a comment on ${ideaDisplay}.</p>`,
          ctaText: "View Comment",
          ctaUrl: ideaUrl,
          footerText: "You received this because you were mentioned in a comment.",
        }),
      };
    }

    case "collaboration_request": {
      return {
        subject: `${actorName} wants to collaborate on your idea`,
        html: buildEmailHtml({
          heading: "New collaboration request",
          bodyHtml: `<p style="margin:0;">${escapeBody(actorName)} has requested to collaborate on ${ideaDisplay}.</p>`,
          ctaText: "Review Request",
          ctaUrl: ideaUrl,
          footerText: "You received this because someone wants to collaborate on your idea.",
        }),
      };
    }

    case "collaboration_response": {
      return {
        subject: `Your collaboration request was reviewed`,
        html: buildEmailHtml({
          heading: "Collaboration request update",
          bodyHtml: `<p style="margin:0;">${escapeBody(actorName)} responded to your collaboration request on ${ideaDisplay}.</p>`,
          ctaText: "View Idea",
          ctaUrl: ideaUrl,
          footerText: "You received this because your collaboration request was reviewed.",
        }),
      };
    }

    case "discussion": {
      return {
        subject: `${actorName} started a discussion on your idea`,
        html: buildEmailHtml({
          heading: "New discussion",
          bodyHtml: `<p style="margin:0;">${escapeBody(actorName)} started a new discussion on ${ideaDisplay}.</p>`,
          ctaText: "View Discussion",
          ctaUrl: discussionUrl,
          footerText: "You received this because a new discussion was started on your idea.",
        }),
      };
    }

    case "discussion_reply": {
      return {
        subject: `${actorName} replied to a discussion`,
        html: buildEmailHtml({
          heading: "New discussion reply",
          bodyHtml: `<p style="margin:0;">${escapeBody(actorName)} replied to a discussion on ${ideaDisplay}.</p>`,
          ctaText: "View Discussion",
          ctaUrl: discussionUrl,
          footerText: "You received this because someone replied to a discussion you participated in.",
        }),
      };
    }

    case "discussion_mention": {
      return {
        subject: `${actorName} mentioned you in a discussion`,
        html: buildEmailHtml({
          heading: "You were mentioned",
          bodyHtml: `<p style="margin:0;">${escapeBody(actorName)} mentioned you in a discussion on ${ideaDisplay}.</p>`,
          ctaText: "View Discussion",
          ctaUrl: discussionUrl,
          footerText: "You received this because you were mentioned in a discussion.",
        }),
      };
    }

    default:
      return null;
  }
}

function escapeBody(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
