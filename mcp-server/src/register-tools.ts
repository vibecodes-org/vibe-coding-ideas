import type { McpContext } from "./context";

// Use a duck-typed interface to avoid version conflicts between the main app's
// @modelcontextprotocol/sdk (via mcp-handler) and the mcp-server's copy.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyMcpServer = { tool: (...args: any[]) => any };
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ServerExtra = { authInfo?: any; [key: string]: any };

import {
  listIdeas,
  listIdeasSchema,
  getIdea,
  getIdeaSchema,
  updateIdeaDescription,
  updateIdeaDescriptionSchema,
  createIdea,
  createIdeaSchema,
  deleteIdea,
  deleteIdeaSchema,
  updateIdeaStatus,
  updateIdeaStatusSchema,
  updateIdeaTags,
  updateIdeaTagsSchema,
} from "./tools/ideas";
import {
  getBoard,
  getBoardSchema,
  getTask,
  getTaskSchema,
  getMyTasks,
  getMyTasksSchema,
} from "./tools/board-read";
import {
  createTask,
  createTaskSchema,
  updateTask,
  updateTaskSchema,
  moveTask,
  moveTaskSchema,
  deleteTask,
  deleteTaskSchema,
} from "./tools/board-write";
import {
  addIdeaComment,
  addIdeaCommentSchema,
  addTaskComment,
  addTaskCommentSchema,
} from "./tools/comments";
import {
  toggleVote,
  toggleVoteSchema,
} from "./tools/votes";
import {
  addCollaborator,
  addCollaboratorSchema,
  removeCollaborator,
  removeCollaboratorSchema,
  listCollaborators,
  listCollaboratorsSchema,
} from "./tools/collaborators";
import {
  createColumn,
  createColumnSchema,
  updateColumn,
  updateColumnSchema,
  deleteColumn,
  deleteColumnSchema,
  reorderColumns,
  reorderColumnsSchema,
} from "./tools/columns";
import {
  manageLabels,
  manageLabelsSchema,
  manageChecklist,
  manageChecklistSchema,
  reportBug,
  reportBugSchema,
} from "./tools/labels";
import {
  listDiscussions,
  listDiscussionsSchema,
  getDiscussion,
  getDiscussionSchema,
  addDiscussionReply,
  addDiscussionReplySchema,
  createDiscussion,
  createDiscussionSchema,
  updateDiscussion,
  updateDiscussionSchema,
  deleteDiscussion,
  deleteDiscussionSchema,
  getDiscussionsReadyToConvert,
  getDiscussionsReadyToConvertSchema,
} from "./tools/discussions";
import {
  listAttachments,
  listAttachmentsSchema,
  uploadAttachment,
  uploadAttachmentSchema,
  deleteAttachment,
  deleteAttachmentSchema,
} from "./tools/attachments";
import {
  listNotifications,
  listNotificationsSchema,
  markNotificationRead,
  markNotificationReadSchema,
  markAllNotificationsRead,
  markAllNotificationsReadSchema,
} from "./tools/notifications";
import {
  getAgentMentions,
  getAgentMentionsSchema,
} from "./tools/agent-mentions";
import {
  updateProfile,
  updateProfileSchema,
} from "./tools/profile";
import {
  listBots,
  listBotsSchema,
  getBotPrompt,
  getBotPromptSchema,
  setBotIdentity,
  setBotIdentitySchema,
  createBot,
  createBotSchema,
  toggleAgentVote,
  toggleAgentVoteSchema,
  cloneAgent,
  cloneAgentSchema,
  publishAgent,
  publishAgentSchema,
  listCommunityAgents,
  listCommunityAgentsSchema,
  listFeaturedTeams,
  listFeaturedTeamsSchema,
} from "./tools/bots";
import {
  allocateAgent,
  allocateAgentSchema,
  removeIdeaAgent,
  removeIdeaAgentSchema,
  listIdeaAgents,
  listIdeaAgentsSchema,
} from "./tools/idea-agents";

function jsonResult(data: unknown) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }],
  };
}

function errorResult(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return {
    content: [{ type: "text" as const, text: `Error: ${message}` }],
    isError: true,
  };
}

export function registerTools(
  server: AnyMcpServer,
  getContext: (extra: ServerExtra) => McpContext | Promise<McpContext>,
  onIdentityChange?: (botId: string | null) => void
): void {
  // --- Read Tools ---

  server.tool(
    "list_ideas",
    "List ideas with optional status filter and search. Returns title, status, tags, vote/comment/collaborator counts.",
    listIdeasSchema.shape,
    async (args: Record<string, unknown>, extra: ServerExtra) => {
      try {
        const ctx = await getContext(extra);
        return jsonResult(await listIdeas(ctx, listIdeasSchema.parse(args)));
      } catch (e) {
        return errorResult(e);
      }
    }
  );

  server.tool(
    "get_idea",
    "Get full idea detail including description, recent comments, collaborators, and board summary.",
    getIdeaSchema.shape,
    async (args: Record<string, unknown>, extra: ServerExtra) => {
      try {
        const ctx = await getContext(extra);
        return jsonResult(await getIdea(ctx, getIdeaSchema.parse(args)));
      } catch (e) {
        return errorResult(e);
      }
    }
  );

  server.tool(
    "get_board",
    "Get kanban board overview: columns with task summaries (no descriptions — use get_task for full details). Excludes done columns by default. Initializes default columns if none exist.",
    getBoardSchema.shape,
    async (args: Record<string, unknown>, extra: ServerExtra) => {
      try {
        const ctx = await getContext(extra);
        return jsonResult(await getBoard(ctx, getBoardSchema.parse(args)));
      } catch (e) {
        return errorResult(e);
      }
    }
  );

  server.tool(
    "get_task",
    "Get single task detail including checklist items, comments, and recent activity.",
    getTaskSchema.shape,
    async (args: Record<string, unknown>, extra: ServerExtra) => {
      try {
        const ctx = await getContext(extra);
        return jsonResult(await getTask(ctx, getTaskSchema.parse(args)));
      } catch (e) {
        return errorResult(e);
      }
    }
  );

  server.tool(
    "get_my_tasks",
    "Get tasks assigned to the bot (Claude Code), grouped by idea. Excludes done/archived by default.",
    getMyTasksSchema.shape,
    async (args: Record<string, unknown>, extra: ServerExtra) => {
      try {
        const ctx = await getContext(extra);
        return jsonResult(await getMyTasks(ctx, getMyTasksSchema.parse(args)));
      } catch (e) {
        return errorResult(e);
      }
    }
  );

  // --- Write Tools ---

  server.tool(
    "create_task",
    "Create a new task on a board. Requires idea_id and column_id. Position auto-calculated.",
    createTaskSchema.shape,
    async (args: Record<string, unknown>, extra: ServerExtra) => {
      try {
        const ctx = await getContext(extra);
        return jsonResult(await createTask(ctx, createTaskSchema.parse(args)));
      } catch (e) {
        return errorResult(e);
      }
    }
  );

  server.tool(
    "update_task",
    "Update task fields: title, description, assignee, due date, archived status. Only changed fields need to be provided.",
    updateTaskSchema.shape,
    async (args: Record<string, unknown>, extra: ServerExtra) => {
      try {
        const ctx = await getContext(extra);
        return jsonResult(await updateTask(ctx, updateTaskSchema.parse(args)));
      } catch (e) {
        return errorResult(e);
      }
    }
  );

  server.tool(
    "move_task",
    "Move a task to a different column. Position auto-calculated if not provided.",
    moveTaskSchema.shape,
    async (args: Record<string, unknown>, extra: ServerExtra) => {
      try {
        const ctx = await getContext(extra);
        return jsonResult(await moveTask(ctx, moveTaskSchema.parse(args)));
      } catch (e) {
        return errorResult(e);
      }
    }
  );

  server.tool(
    "delete_task",
    "Permanently delete a task from a board.",
    deleteTaskSchema.shape,
    async (args: Record<string, unknown>, extra: ServerExtra) => {
      try {
        const ctx = await getContext(extra);
        return jsonResult(await deleteTask(ctx, deleteTaskSchema.parse(args)));
      } catch (e) {
        return errorResult(e);
      }
    }
  );

  server.tool(
    "update_idea_description",
    "Update/rewrite an idea's description. Supports markdown.",
    updateIdeaDescriptionSchema.shape,
    async (args: Record<string, unknown>, extra: ServerExtra) => {
      try {
        const ctx = await getContext(extra);
        return jsonResult(
          await updateIdeaDescription(ctx, updateIdeaDescriptionSchema.parse(args))
        );
      } catch (e) {
        return errorResult(e);
      }
    }
  );

  server.tool(
    "create_idea",
    "Create a new idea with title, description, tags, and visibility.",
    createIdeaSchema.shape,
    async (args: Record<string, unknown>, extra: ServerExtra) => {
      try {
        const ctx = await getContext(extra);
        return jsonResult(await createIdea(ctx, createIdeaSchema.parse(args)));
      } catch (e) {
        return errorResult(e);
      }
    }
  );

  server.tool(
    "delete_idea",
    "Delete an idea. Only the author or an admin can delete.",
    deleteIdeaSchema.shape,
    async (args: Record<string, unknown>, extra: ServerExtra) => {
      try {
        const ctx = await getContext(extra);
        return jsonResult(await deleteIdea(ctx, deleteIdeaSchema.parse(args)));
      } catch (e) {
        return errorResult(e);
      }
    }
  );

  server.tool(
    "update_idea_status",
    "Update an idea's status: open, in_progress, completed, or archived.",
    updateIdeaStatusSchema.shape,
    async (args: Record<string, unknown>, extra: ServerExtra) => {
      try {
        const ctx = await getContext(extra);
        return jsonResult(await updateIdeaStatus(ctx, updateIdeaStatusSchema.parse(args)));
      } catch (e) {
        return errorResult(e);
      }
    }
  );

  server.tool(
    "update_idea_tags",
    "Set/replace the tags on an idea.",
    updateIdeaTagsSchema.shape,
    async (args: Record<string, unknown>, extra: ServerExtra) => {
      try {
        const ctx = await getContext(extra);
        return jsonResult(await updateIdeaTags(ctx, updateIdeaTagsSchema.parse(args)));
      } catch (e) {
        return errorResult(e);
      }
    }
  );

  server.tool(
    "toggle_vote",
    "Toggle the current user's upvote on an idea. Adds vote if not voted, removes if already voted.",
    toggleVoteSchema.shape,
    async (args: Record<string, unknown>, extra: ServerExtra) => {
      try {
        const ctx = await getContext(extra);
        return jsonResult(await toggleVote(ctx, toggleVoteSchema.parse(args)));
      } catch (e) {
        return errorResult(e);
      }
    }
  );

  // --- Collaborator Tools ---

  server.tool(
    "add_collaborator",
    "Add a user as collaborator on an idea.",
    addCollaboratorSchema.shape,
    async (args: Record<string, unknown>, extra: ServerExtra) => {
      try {
        const ctx = await getContext(extra);
        return jsonResult(await addCollaborator(ctx, addCollaboratorSchema.parse(args)));
      } catch (e) {
        return errorResult(e);
      }
    }
  );

  server.tool(
    "remove_collaborator",
    "Remove a collaborator from an idea.",
    removeCollaboratorSchema.shape,
    async (args: Record<string, unknown>, extra: ServerExtra) => {
      try {
        const ctx = await getContext(extra);
        return jsonResult(await removeCollaborator(ctx, removeCollaboratorSchema.parse(args)));
      } catch (e) {
        return errorResult(e);
      }
    }
  );

  server.tool(
    "list_collaborators",
    "List all collaborators on an idea with their names and emails.",
    listCollaboratorsSchema.shape,
    async (args: Record<string, unknown>, extra: ServerExtra) => {
      try {
        const ctx = await getContext(extra);
        return jsonResult(await listCollaborators(ctx, listCollaboratorsSchema.parse(args)));
      } catch (e) {
        return errorResult(e);
      }
    }
  );

  // --- Column Tools ---

  server.tool(
    "create_column",
    "Create a new board column. Position auto-calculated at the end.",
    createColumnSchema.shape,
    async (args: Record<string, unknown>, extra: ServerExtra) => {
      try {
        const ctx = await getContext(extra);
        return jsonResult(await createColumn(ctx, createColumnSchema.parse(args)));
      } catch (e) {
        return errorResult(e);
      }
    }
  );

  server.tool(
    "update_column",
    "Update a board column's title or done status.",
    updateColumnSchema.shape,
    async (args: Record<string, unknown>, extra: ServerExtra) => {
      try {
        const ctx = await getContext(extra);
        return jsonResult(await updateColumn(ctx, updateColumnSchema.parse(args)));
      } catch (e) {
        return errorResult(e);
      }
    }
  );

  server.tool(
    "delete_column",
    "Delete an empty board column. Fails if column has tasks.",
    deleteColumnSchema.shape,
    async (args: Record<string, unknown>, extra: ServerExtra) => {
      try {
        const ctx = await getContext(extra);
        return jsonResult(await deleteColumn(ctx, deleteColumnSchema.parse(args)));
      } catch (e) {
        return errorResult(e);
      }
    }
  );

  server.tool(
    "reorder_columns",
    "Reorder board columns by providing column IDs in desired order.",
    reorderColumnsSchema.shape,
    async (args: Record<string, unknown>, extra: ServerExtra) => {
      try {
        const ctx = await getContext(extra);
        return jsonResult(await reorderColumns(ctx, reorderColumnsSchema.parse(args)));
      } catch (e) {
        return errorResult(e);
      }
    }
  );

  // --- Supporting Tools ---

  server.tool(
    "manage_labels",
    "Create labels, add labels to tasks, or remove labels from tasks. Actions: create, add_to_task, remove_from_task.",
    manageLabelsSchema.shape,
    async (args: Record<string, unknown>, extra: ServerExtra) => {
      try {
        const ctx = await getContext(extra);
        return jsonResult(await manageLabels(ctx, manageLabelsSchema.parse(args)));
      } catch (e) {
        return errorResult(e);
      }
    }
  );

  server.tool(
    "manage_checklist",
    "Add, toggle, or delete checklist items on a task. Actions: add, toggle, delete.",
    manageChecklistSchema.shape,
    async (args: Record<string, unknown>, extra: ServerExtra) => {
      try {
        const ctx = await getContext(extra);
        return jsonResult(
          await manageChecklist(ctx, manageChecklistSchema.parse(args))
        );
      } catch (e) {
        return errorResult(e);
      }
    }
  );

  server.tool(
    "add_idea_comment",
    "Add a comment to an idea. Types: comment, suggestion, question. Posted as Claude Code bot.",
    addIdeaCommentSchema.shape,
    async (args: Record<string, unknown>, extra: ServerExtra) => {
      try {
        const ctx = await getContext(extra);
        return jsonResult(
          await addIdeaComment(ctx, addIdeaCommentSchema.parse(args))
        );
      } catch (e) {
        return errorResult(e);
      }
    }
  );

  server.tool(
    "add_task_comment",
    "Add a comment to a board task. Posted as Claude Code bot.",
    addTaskCommentSchema.shape,
    async (args: Record<string, unknown>, extra: ServerExtra) => {
      try {
        const ctx = await getContext(extra);
        return jsonResult(
          await addTaskComment(ctx, addTaskCommentSchema.parse(args))
        );
      } catch (e) {
        return errorResult(e);
      }
    }
  );

  server.tool(
    "report_bug",
    "Convenience tool: creates a task with a red 'Bug' label, assigned to Claude Code. Uses first column (To Do) by default.",
    reportBugSchema.shape,
    async (args: Record<string, unknown>, extra: ServerExtra) => {
      try {
        const ctx = await getContext(extra);
        return jsonResult(await reportBug(ctx, reportBugSchema.parse(args)));
      } catch (e) {
        return errorResult(e);
      }
    }
  );

  // --- Discussion Tools ---

  server.tool(
    "list_discussions",
    "List discussions for an idea with optional status filter. Returns title, status, reply count, author, and last activity.",
    listDiscussionsSchema.shape,
    async (args: Record<string, unknown>, extra: ServerExtra) => {
      try {
        const ctx = await getContext(extra);
        return jsonResult(await listDiscussions(ctx, listDiscussionsSchema.parse(args)));
      } catch (e) {
        return errorResult(e);
      }
    }
  );

  server.tool(
    "get_discussion",
    "Get full discussion thread including body, all replies with nested structure, and author details.",
    getDiscussionSchema.shape,
    async (args: Record<string, unknown>, extra: ServerExtra) => {
      try {
        const ctx = await getContext(extra);
        return jsonResult(await getDiscussion(ctx, getDiscussionSchema.parse(args)));
      } catch (e) {
        return errorResult(e);
      }
    }
  );

  server.tool(
    "add_discussion_reply",
    "Add a reply to a discussion thread. Posted as the active bot identity. Supports nested replies via parent_reply_id.",
    addDiscussionReplySchema.shape,
    async (args: Record<string, unknown>, extra: ServerExtra) => {
      try {
        const ctx = await getContext(extra);
        return jsonResult(await addDiscussionReply(ctx, addDiscussionReplySchema.parse(args)));
      } catch (e) {
        return errorResult(e);
      }
    }
  );

  server.tool(
    "create_discussion",
    "Create a new discussion thread on an idea. Requires title and body (markdown).",
    createDiscussionSchema.shape,
    async (args: Record<string, unknown>, extra: ServerExtra) => {
      try {
        const ctx = await getContext(extra);
        return jsonResult(await createDiscussion(ctx, createDiscussionSchema.parse(args)));
      } catch (e) {
        return errorResult(e);
      }
    }
  );

  server.tool(
    "update_discussion",
    "Update a discussion's title, body, status (open/resolved/converted), or pinned state. Only changed fields need to be provided.",
    updateDiscussionSchema.shape,
    async (args: Record<string, unknown>, extra: ServerExtra) => {
      try {
        const ctx = await getContext(extra);
        return jsonResult(await updateDiscussion(ctx, updateDiscussionSchema.parse(args)));
      } catch (e) {
        return errorResult(e);
      }
    }
  );

  server.tool(
    "delete_discussion",
    "Permanently delete a discussion thread and all its replies from an idea.",
    deleteDiscussionSchema.shape,
    async (args: Record<string, unknown>, extra: ServerExtra) => {
      try {
        const ctx = await getContext(extra);
        return jsonResult(await deleteDiscussion(ctx, deleteDiscussionSchema.parse(args)));
      } catch (e) {
        return errorResult(e);
      }
    }
  );

  server.tool(
    "get_discussions_ready_to_convert",
    "Get discussions marked as ready to convert into board tasks. Returns full context with replies, target column, and assignee. Includes workflow instructions for creating tasks.",
    getDiscussionsReadyToConvertSchema.shape,
    async (args: Record<string, unknown>, extra: ServerExtra) => {
      try {
        const ctx = await getContext(extra);
        return jsonResult(await getDiscussionsReadyToConvert(ctx, getDiscussionsReadyToConvertSchema.parse(args)));
      } catch (e) {
        return errorResult(e);
      }
    }
  );

  // --- Attachment Tools ---

  server.tool(
    "list_attachments",
    "List all attachments for a task with 1-hour signed download URLs.",
    listAttachmentsSchema.shape,
    async (args: Record<string, unknown>, extra: ServerExtra) => {
      try {
        const ctx = await getContext(extra);
        return jsonResult(await listAttachments(ctx, listAttachmentsSchema.parse(args)));
      } catch (e) {
        return errorResult(e);
      }
    }
  );

  server.tool(
    "upload_attachment",
    "Upload a file attachment to a task. Accepts base64-encoded file content. Max 10MB. Auto-sets cover image for first image upload.",
    uploadAttachmentSchema.shape,
    async (args: Record<string, unknown>, extra: ServerExtra) => {
      try {
        const ctx = await getContext(extra);
        return jsonResult(await uploadAttachment(ctx, uploadAttachmentSchema.parse(args)));
      } catch (e) {
        return errorResult(e);
      }
    }
  );

  server.tool(
    "delete_attachment",
    "Delete a file attachment from a task. Also clears cover image if the deleted attachment was the cover.",
    deleteAttachmentSchema.shape,
    async (args: Record<string, unknown>, extra: ServerExtra) => {
      try {
        const ctx = await getContext(extra);
        return jsonResult(await deleteAttachment(ctx, deleteAttachmentSchema.parse(args)));
      } catch (e) {
        return errorResult(e);
      }
    }
  );

  // --- Notification Tools ---

  server.tool(
    "list_notifications",
    "List notifications for the current user. Supports unread-only filter and limit.",
    listNotificationsSchema.shape,
    async (args: Record<string, unknown>, extra: ServerExtra) => {
      try {
        const ctx = await getContext(extra);
        return jsonResult(await listNotifications(ctx, listNotificationsSchema.parse(args)));
      } catch (e) {
        return errorResult(e);
      }
    }
  );

  server.tool(
    "mark_notification_read",
    "Mark a single notification as read.",
    markNotificationReadSchema.shape,
    async (args: Record<string, unknown>, extra: ServerExtra) => {
      try {
        const ctx = await getContext(extra);
        return jsonResult(await markNotificationRead(ctx, markNotificationReadSchema.parse(args)));
      } catch (e) {
        return errorResult(e);
      }
    }
  );

  server.tool(
    "mark_all_notifications_read",
    "Mark all unread notifications as read for the current user.",
    markAllNotificationsReadSchema.shape,
    async (args: Record<string, unknown>, extra: ServerExtra) => {
      try {
        const ctx = await getContext(extra);
        return jsonResult(await markAllNotificationsRead(ctx));
      } catch (e) {
        return errorResult(e);
      }
    }
  );

  server.tool(
    "get_agent_mentions",
    "Get unread @mentions for your agents in discussions. Returns enriched context with agent, actor, idea, and discussion info plus response workflow instructions.",
    getAgentMentionsSchema.shape,
    async (args: Record<string, unknown>, extra: ServerExtra) => {
      try {
        const ctx = await getContext(extra);
        return jsonResult(await getAgentMentions(ctx, getAgentMentionsSchema.parse(args)));
      } catch (e) {
        return errorResult(e);
      }
    }
  );

  // --- Profile Tools ---

  server.tool(
    "update_profile",
    "Update the current user's profile: full_name, bio, github_username, avatar_url, contact_info. Only changed fields need to be provided.",
    updateProfileSchema.shape,
    async (args: Record<string, unknown>, extra: ServerExtra) => {
      try {
        const ctx = await getContext(extra);
        return jsonResult(await updateProfile(ctx, updateProfileSchema.parse(args)));
      } catch (e) {
        return errorResult(e);
      }
    }
  );

  // --- Agent Tools ---

  server.tool(
    "list_agents",
    "List agents owned by the current user (or a specific owner). Returns agent profiles with name, role, system prompt, and active status.",
    listBotsSchema.shape,
    async (args: Record<string, unknown>, extra: ServerExtra) => {
      try {
        const ctx = await getContext(extra);
        return jsonResult(await listBots(ctx, listBotsSchema.parse(args)));
      } catch (e) {
        return errorResult(e);
      }
    }
  );

  server.tool(
    "get_agent_prompt",
    "Get the system prompt for a specific agent or the current active agent identity.",
    getBotPromptSchema.shape,
    async (args: Record<string, unknown>, extra: ServerExtra) => {
      try {
        const ctx = await getContext(extra);
        return jsonResult(await getBotPrompt(ctx, getBotPromptSchema.parse(args)));
      } catch (e) {
        return errorResult(e);
      }
    }
  );

  server.tool(
    "set_agent_identity",
    "Switch session identity to an agent persona. Provide agent_id or agent_name. Omit both to reset to default identity. Returns the agent's system prompt.",
    setBotIdentitySchema.shape,
    async (args: Record<string, unknown>, extra: ServerExtra) => {
      try {
        const ctx = await getContext(extra);
        const changeHandler = onIdentityChange ?? (() => {});
        return jsonResult(
          await setBotIdentity(ctx, setBotIdentitySchema.parse(args), changeHandler)
        );
      } catch (e) {
        return errorResult(e);
      }
    }
  );

  server.tool(
    "create_agent",
    "Create a new agent profile with a name, role, and system prompt. The agent gets its own user identity for assignments and activity logs.",
    createBotSchema.shape,
    async (args: Record<string, unknown>, extra: ServerExtra) => {
      try {
        const ctx = await getContext(extra);
        return jsonResult(await createBot(ctx, createBotSchema.parse(args)));
      } catch (e) {
        return errorResult(e);
      }
    }
  );

  // --- Agent Community Tools ---

  server.tool(
    "toggle_agent_vote",
    "Toggle the current user's upvote on a published agent. Adds vote if not voted, removes if already voted.",
    toggleAgentVoteSchema.shape,
    async (args: Record<string, unknown>, extra: ServerExtra) => {
      try {
        const ctx = await getContext(extra);
        return jsonResult(await toggleAgentVote(ctx, toggleAgentVoteSchema.parse(args)));
      } catch (e) {
        return errorResult(e);
      }
    }
  );

  server.tool(
    "clone_agent",
    "Clone a published agent to your own agent list. Creates an independent copy with provenance tracking.",
    cloneAgentSchema.shape,
    async (args: Record<string, unknown>, extra: ServerExtra) => {
      try {
        const ctx = await getContext(extra);
        return jsonResult(await cloneAgent(ctx, cloneAgentSchema.parse(args)));
      } catch (e) {
        return errorResult(e);
      }
    }
  );

  server.tool(
    "publish_agent",
    "Publish or unpublish an agent to the community marketplace. Optionally share the system prompt.",
    publishAgentSchema.shape,
    async (args: Record<string, unknown>, extra: ServerExtra) => {
      try {
        const ctx = await getContext(extra);
        return jsonResult(await publishAgent(ctx, publishAgentSchema.parse(args)));
      } catch (e) {
        return errorResult(e);
      }
    }
  );

  server.tool(
    "list_community_agents",
    "List published agents from the community with optional search, role filter, and sort.",
    listCommunityAgentsSchema.shape,
    async (args: Record<string, unknown>, extra: ServerExtra) => {
      try {
        const ctx = await getContext(extra);
        return jsonResult(await listCommunityAgents(ctx, listCommunityAgentsSchema.parse(args)));
      } catch (e) {
        return errorResult(e);
      }
    }
  );

  server.tool(
    "list_featured_teams",
    "List featured agent teams with their bundled agents. Active teams only by default.",
    listFeaturedTeamsSchema.shape,
    async (args: Record<string, unknown>, extra: ServerExtra) => {
      try {
        const ctx = await getContext(extra);
        return jsonResult(await listFeaturedTeams(ctx, listFeaturedTeamsSchema.parse(args)));
      } catch (e) {
        return errorResult(e);
      }
    }
  );

  // --- Idea Agent Pool Tools ---

  server.tool(
    "allocate_agent",
    "Allocate a bot to an idea's shared agent pool. The bot becomes available for task assignment by all team members.",
    allocateAgentSchema.shape,
    async (args: Record<string, unknown>, extra: ServerExtra) => {
      try {
        const ctx = await getContext(extra);
        return jsonResult(await allocateAgent(ctx, allocateAgentSchema.parse(args)));
      } catch (e) {
        return errorResult(e);
      }
    }
  );

  server.tool(
    "remove_idea_agent",
    "Remove a bot from an idea's shared agent pool. The bot will be unassigned from any tasks in that idea.",
    removeIdeaAgentSchema.shape,
    async (args: Record<string, unknown>, extra: ServerExtra) => {
      try {
        const ctx = await getContext(extra);
        return jsonResult(await removeIdeaAgent(ctx, removeIdeaAgentSchema.parse(args)));
      } catch (e) {
        return errorResult(e);
      }
    }
  );

  server.tool(
    "list_idea_agents",
    "List all agents allocated to an idea's shared pool with bot profile details and who added them.",
    listIdeaAgentsSchema.shape,
    async (args: Record<string, unknown>, extra: ServerExtra) => {
      try {
        const ctx = await getContext(extra);
        return jsonResult(await listIdeaAgents(ctx, listIdeaAgentsSchema.parse(args)));
      } catch (e) {
        return errorResult(e);
      }
    }
  );
}
