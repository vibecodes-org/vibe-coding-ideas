import type { Database } from "./database";

// Base row types
export type User = Database["public"]["Tables"]["users"]["Row"];
export type Idea = Database["public"]["Tables"]["ideas"]["Row"];
export type Comment = Database["public"]["Tables"]["comments"]["Row"];
export type Collaborator = Database["public"]["Tables"]["collaborators"]["Row"];
export type Vote = Database["public"]["Tables"]["votes"]["Row"];
export type Notification = Database["public"]["Tables"]["notifications"]["Row"];

// Enums
export type IdeaStatus = Database["public"]["Enums"]["idea_status"];
export type IdeaVisibility = Database["public"]["Enums"]["idea_visibility"];
export type CommentType = Database["public"]["Enums"]["comment_type"];
export type VoteType = Database["public"]["Enums"]["vote_type"];
export type NotificationType = Database["public"]["Enums"]["notification_type"];

// Derived types
export type IdeaWithAuthor = Idea & {
  author: User;
};

export type CommentWithAuthor = Comment & {
  author: User;
  replies?: CommentWithAuthor[];
};

export type IdeaDetail = Idea & {
  author: User;
  comments: CommentWithAuthor[];
  collaborators: CollaboratorWithUser[];
  user_vote?: Vote | null;
  is_collaborator?: boolean;
};

export type CollaboratorWithUser = Collaborator & {
  user: User;
};

export type NotificationWithDetails = Notification & {
  actor: User;
  idea: { id: string; title: string } | null;
};

// Notification preferences
export type NotificationPreferences = User["notification_preferences"];

// Board types
export type BoardColumn = Database["public"]["Tables"]["board_columns"]["Row"];
export type BoardTask = Database["public"]["Tables"]["board_tasks"]["Row"];
export type BoardLabel = Database["public"]["Tables"]["board_labels"]["Row"];
export type BoardTaskLabel = Database["public"]["Tables"]["board_task_labels"]["Row"];
export type AiPromptTemplate = Database["public"]["Tables"]["ai_prompt_templates"]["Row"];
export type BoardChecklistItem = Database["public"]["Tables"]["board_checklist_items"]["Row"];
export type BoardTaskActivity = Database["public"]["Tables"]["board_task_activity"]["Row"];
export type BoardTaskComment = Database["public"]["Tables"]["board_task_comments"]["Row"];
export type BoardTaskAttachment = Database["public"]["Tables"]["board_task_attachments"]["Row"];
export type IdeaAttachment = Database["public"]["Tables"]["idea_attachments"]["Row"];
export type BotProfile = Database["public"]["Tables"]["bot_profiles"]["Row"];
export type BoardTaskWithAssignee = BoardTask & {
  assignee: User | null;
  labels: BoardLabel[];
};
export type BoardColumnWithTasks = BoardColumn & { tasks: BoardTaskWithAssignee[] };
export type BoardTaskActivityWithActor = BoardTaskActivity & { actor: User };
export type BoardTaskCommentWithAuthor = BoardTaskComment & { author: User };

// Dashboard types
export type DashboardTask = BoardTask & {
  assignee: User | null;
  labels: BoardLabel[];
  column: { id: string; title: string; is_done_column: boolean };
  idea: { id: string; title: string };
};

// Dashboard bot types
export type DashboardBotTask = {
  id: string;
  title: string;
  idea: { id: string; title: string };
  column: { title: string };
};

export type DashboardBotActivity = {
  action: string;
  created_at: string;
};

export type DashboardBot = BotProfile & {
  currentTask: DashboardBotTask | null;
  lastActivity: DashboardBotActivity | null;
  isActiveMcpBot: boolean;
};

// Discussion types
export type IdeaDiscussion = Database["public"]["Tables"]["idea_discussions"]["Row"];
export type IdeaDiscussionReply = Database["public"]["Tables"]["idea_discussion_replies"]["Row"];
export type DiscussionVote = Database["public"]["Tables"]["discussion_votes"]["Row"];
export type DiscussionStatus = Database["public"]["Enums"]["discussion_status"];
export type IdeaDiscussionWithAuthor = IdeaDiscussion & {
  author: User;
};
export type IdeaDiscussionReplyWithAuthor = IdeaDiscussionReply & {
  author: User;
};
export type IdeaDiscussionReplyWithChildren = IdeaDiscussionReplyWithAuthor & {
  children: IdeaDiscussionReplyWithAuthor[];
};
export type IdeaDiscussionDetail = IdeaDiscussion & {
  author: User;
  replies: IdeaDiscussionReplyWithAuthor[];
};

// Idea Agent Pool types
export type IdeaAgent = Database["public"]["Tables"]["idea_agents"]["Row"];
export type IdeaAgentWithDetails = IdeaAgent & {
  bot: BotProfile & { owner: { id: string; full_name: string | null } };
};
export type IdeaAgentUser = User & { ownerName: string; ownerId: string };

// AI usage types
export type AiUsageLog = Database["public"]["Tables"]["ai_usage_log"]["Row"];

// Collaboration request types
export type CollaborationRequest = Database["public"]["Tables"]["collaboration_requests"]["Row"];
export type CollaborationRequestStatus = Database["public"]["Enums"]["collaboration_request_status"];
export type CollaborationRequestWithRequester = CollaborationRequest & {
  requester: User;
};

// Sort options
export type SortOption = "newest" | "popular" | "discussed";
