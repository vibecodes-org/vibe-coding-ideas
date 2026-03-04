import { supabaseAdmin } from "./supabase-admin";

const E2E_PREFIX = "[E2E]";

const TEST_USER_EMAILS: Record<string, string> = {
  userA: process.env.TEST_USER_A_EMAIL ?? "test-user-a@vibecodes-test.local",
  userB: process.env.TEST_USER_B_EMAIL ?? "test-user-b@vibecodes-test.local",
  admin: process.env.TEST_ADMIN_EMAIL ?? "test-admin@vibecodes-test.local",
  fresh: process.env.TEST_FRESH_EMAIL ?? "test-fresh@vibecodes-test.local",
};

/** Look up a test user's ID by key (userA, userB, admin, fresh) */
export async function getTestUserId(key: string): Promise<string> {
  const email = TEST_USER_EMAILS[key];
  if (!email) throw new Error(`Unknown test user key: ${key}`);
  const { data, error } = await supabaseAdmin
    .from("users")
    .select("id")
    .eq("email", email)
    .maybeSingle();
  if (error || !data) throw new Error(`Test user "${key}" (${email}) not found`);
  return data.id;
}

/** Create a unique scoped title for test data to avoid collisions between parallel runs */
export function scopedTitle(base: string): string {
  return `${E2E_PREFIX} ${base} ${Date.now()}`;
}

/** Create a test idea with [E2E] prefix for reliable cleanup */
export async function createTestIdea(
  authorId: string,
  overrides: {
    title?: string;
    description?: string;
    tags?: string[];
    visibility?: "public" | "private";
    status?: string;
  } = {}
) {
  const { data, error } = await supabaseAdmin
    .from("ideas")
    .insert({
      title: overrides.title ?? `${E2E_PREFIX} Test Idea ${Date.now()}`,
      description: overrides.description ?? `${E2E_PREFIX} Description for testing`,
      tags: overrides.tags ?? ["e2e-test"],
      visibility: overrides.visibility ?? "public",
      status: overrides.status ?? "open",
      author_id: authorId,
    })
    .select()
    .single();

  if (error) throw new Error(`Failed to create test idea: ${error.message}`);
  return data;
}

/** Create default board columns for an idea */
export async function createTestBoardColumns(ideaId: string) {
  const columns = [
    { idea_id: ideaId, title: "To Do", position: 1000, is_done_column: false },
    { idea_id: ideaId, title: "In Progress", position: 2000, is_done_column: false },
    { idea_id: ideaId, title: "Done", position: 3000, is_done_column: true },
  ];

  const { data, error } = await supabaseAdmin
    .from("board_columns")
    .insert(columns)
    .select();

  if (error) throw new Error(`Failed to create board columns: ${error.message}`);
  return data;
}

/** Create a test board with columns and tasks */
export async function createTestBoardWithTasks(
  ideaId: string,
  taskCount: number = 3
) {
  const columns = await createTestBoardColumns(ideaId);
  const todoColumn = columns.find((c) => c.title === "To Do")!;

  const tasks = Array.from({ length: taskCount }, (_, i) => ({
    column_id: todoColumn.id,
    idea_id: ideaId,
    title: `${E2E_PREFIX} Task ${i + 1}`,
    description: `Task ${i + 1} description`,
    position: (i + 1) * 1000,
  }));

  const { data, error } = await supabaseAdmin
    .from("board_tasks")
    .insert(tasks)
    .select();

  if (error) throw new Error(`Failed to create test tasks: ${error.message}`);
  return { columns, tasks: data };
}

/** Add a collaborator to an idea */
export async function addCollaborator(ideaId: string, userId: string) {
  const { error } = await supabaseAdmin
    .from("collaborators")
    .insert({ idea_id: ideaId, user_id: userId });

  if (error && error.code !== "23505") {
    throw new Error(`Failed to add collaborator: ${error.message}`);
  }
}

/** Create a vote on an idea */
export async function createTestVote(ideaId: string, userId: string) {
  const { error } = await supabaseAdmin
    .from("votes")
    .insert({ idea_id: ideaId, user_id: userId });

  if (error && error.code !== "23505") {
    throw new Error(`Failed to create vote: ${error.message}`);
  }
}

/** Create a test comment on an idea */
export async function createTestComment(
  ideaId: string,
  authorId: string,
  overrides: { content?: string; type?: string; parent_comment_id?: string } = {}
) {
  const { data, error } = await supabaseAdmin
    .from("comments")
    .insert({
      idea_id: ideaId,
      author_id: authorId,
      content: overrides.content ?? `${E2E_PREFIX} Test comment ${Date.now()}`,
      type: overrides.type ?? "comment",
      parent_comment_id: overrides.parent_comment_id ?? null,
    })
    .select()
    .single();

  if (error) throw new Error(`Failed to create comment: ${error.message}`);
  return data;
}

/** Create a test discussion on an idea */
export async function createTestDiscussion(
  ideaId: string,
  authorId: string,
  overrides: {
    title?: string;
    body?: string;
    status?: "open" | "resolved" | "ready_to_convert" | "converted";
    pinned?: boolean;
    target_column_id?: string;
    target_assignee_id?: string;
  } = {}
) {
  const { data, error } = await supabaseAdmin
    .from("idea_discussions")
    .insert({
      idea_id: ideaId,
      author_id: authorId,
      title: overrides.title ?? `${E2E_PREFIX} Discussion ${Date.now()}`,
      body: overrides.body ?? `${E2E_PREFIX} Discussion body for testing.`,
      status: overrides.status ?? "open",
      pinned: overrides.pinned ?? false,
      target_column_id: overrides.target_column_id ?? null,
      target_assignee_id: overrides.target_assignee_id ?? null,
    })
    .select()
    .single();

  if (error) throw new Error(`Failed to create test discussion: ${error.message}`);
  return data;
}

/** Create a test discussion reply */
export async function createTestDiscussionReply(
  discussionId: string,
  authorId: string,
  overrides: { content?: string } = {}
) {
  const { data, error } = await supabaseAdmin
    .from("idea_discussion_replies")
    .insert({
      discussion_id: discussionId,
      author_id: authorId,
      content: overrides.content ?? `${E2E_PREFIX} Reply ${Date.now()}`,
    })
    .select()
    .single();

  if (error) throw new Error(`Failed to create test discussion reply: ${error.message}`);
  return data;
}

/** Clean up specific ideas by ID (cascades to board, comments, etc.) */
export async function cleanupIdeas(ideaIds: string[]) {
  if (ideaIds.length === 0) return;
  await supabaseAdmin
    .from("ideas")
    .delete()
    .in("id", ideaIds);
}

/** Clean up all E2E test data. Deletes ideas with [E2E] prefix (cascades to board, comments, etc.) */
export async function cleanupTestData() {
  // Delete ideas with E2E prefix — cascades to comments, collaborators, votes, board data
  await supabaseAdmin
    .from("ideas")
    .delete()
    .like("title", `${E2E_PREFIX}%`);

  // Also clean up any orphaned board tasks with E2E prefix
  await supabaseAdmin
    .from("board_tasks")
    .delete()
    .like("title", `${E2E_PREFIX}%`);
}
