export const dynamic = "force-dynamic";

import { createClient } from "@supabase/supabase-js";
import { logger } from "@/lib/logger";
import { buildNotificationUrl } from "@/lib/notification-url";
import { buildNotificationEmail, buildSnippet } from "@/lib/notification-email";
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
    logger.error("NOTIFICATION_WEBHOOK_SECRET not configured");
    return jsonResponse({ error: "Server misconfigured" }, 500);
  }

  if (authHeader !== `Bearer ${expectedSecret}`) {
    return jsonResponse({ error: "Unauthorized" }, 401);
  }

  const resendApiKey = process.env.RESEND_API_KEY;
  if (!resendApiKey) {
    logger.error("RESEND_API_KEY not configured");
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
      reply_id: string | null;
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

  // Get idea title + description if applicable (description feeds the
  // fallback snippet when there's no comment/reply to quote).
  let ideaTitle: string | null = null;
  let ideaDescription: string | null = null;
  if (notification.idea_id) {
    const { data: idea } = await supabase
      .from("ideas")
      .select("title, description")
      .eq("id", notification.idea_id)
      .maybeSingle();
    ideaTitle = idea?.title || null;
    ideaDescription = idea?.description || null;
  }

  // Get task title + description if applicable
  let taskTitle: string | null = null;
  let taskDescription: string | null = null;
  if (notification.task_id) {
    const { data: task } = await supabase
      .from("board_tasks")
      .select("title, description")
      .eq("id", notification.task_id)
      .maybeSingle();
    taskTitle = task?.title || null;
    taskDescription = task?.description || null;
  }

  // Fetch the actual comment/reply text driving this notification, so the
  // email can quote it instead of just naming the task/idea it landed on.
  let commentBody: string | null = null;
  if (notification.comment_id) {
    // Task comments and mentions live in board_task_comments; idea comments
    // and mentions live in comments.
    const table = notification.type === "task_mention" ? "board_task_comments" : "comments";
    const { data } = await supabase
      .from(table)
      .select("content")
      .eq("id", notification.comment_id)
      .maybeSingle();
    commentBody = data?.content ?? null;
  } else if (notification.reply_id) {
    const { data } = await supabase
      .from("idea_discussion_replies")
      .select("content")
      .eq("id", notification.reply_id)
      .maybeSingle();
    commentBody = data?.content ?? null;
  }

  // Fall back to the task/idea description when there's no comment to quote
  // (e.g. a status change, or a comment row that no longer resolves) — never
  // let a missing snippet break the send, just degrade to the plain sentence.
  const snippet = buildSnippet(commentBody ?? taskDescription ?? ideaDescription ?? null);

  // Build email content based on notification type
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || "https://vibecodes.co.uk";
  const ctaUrl = buildNotificationUrl({
    type: notification.type,
    ideaId: notification.idea_id,
    commentId: notification.comment_id,
    taskId: notification.task_id,
    discussionId: notification.discussion_id,
    replyId: notification.reply_id,
    appUrl,
  });
  const email = buildNotificationEmail({
    type: notification.type,
    actorName,
    ideaTitle,
    taskTitle,
    snippet,
    ctaUrl,
  });

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
      logger.error("Resend API error", { status: res.status, response: errorText });
      return jsonResponse(
        { error: "Email send failed", details: errorText },
        502,
      );
    }

    const result = await res.json();
    return jsonResponse({ sent: true, id: result.id });
  } catch (err) {
    logger.error("Failed to send email", { error: err instanceof Error ? err.message : String(err) });
    return jsonResponse({ error: "Email send failed" }, 500);
  }
}

