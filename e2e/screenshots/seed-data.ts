import { supabaseAdmin } from "../fixtures/supabase-admin";
import { getTestUserId, addCollaborator } from "../fixtures/test-data";

const SCREENSHOT_TAG = "screenshot-seed";
const THREE_DAYS_AGO = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString();

export interface SeededData {
  userIds: { userA: string; userB: string; admin: string };
  originalNames: Record<string, string>;
  ideaIds: string[];
  primaryIdeaId: string;
  columnIds: Record<string, string>;
  taskIds: string[];
  labelIds: string[];
  commentIds: string[];
  discussionId: string;
  discussionReplyIds: string[];
  botIds: string[];
}

// ── Module-level fallback for guaranteed name restore ──
let _originalNames: Record<string, string> = {};
let _userIds: Record<string, string> = {};

export function getOriginalNames() {
  return _originalNames;
}
export function getUserIds() {
  return _userIds;
}

// ── Realistic data definitions ──

const IDEAS = [
  {
    title: "AI-Powered Recipe Generator",
    description: `## Overview
A smart recipe recommendation engine that learns your taste preferences and dietary restrictions to suggest personalized meals.

## Key Features
- **Taste Profile Learning** — Collaborative filtering to understand flavor preferences
- **Dietary Restriction Support** — Allergies, vegan, keto, gluten-free, and more
- **Ingredient-Based Search** — "What can I make with what's in my fridge?"
- **Meal Planning** — Weekly meal plans with automatic grocery lists
- **Nutritional Tracking** — Calories, macros, and micronutrient breakdown

## Technical Stack
- Next.js 16 with App Router for the frontend
- Supabase for auth, database, and real-time subscriptions
- Anthropic Claude API for recipe analysis and suggestions
- Spoonacular API for recipe data enrichment

## User Stories
1. As a home cook, I want to input my available ingredients and get recipe suggestions
2. As someone with allergies, I want to filter out recipes containing my allergens
3. As a meal planner, I want to generate a weekly plan that minimizes food waste`,
    tags: ["ai", "food-tech", "nextjs", SCREENSHOT_TAG],
    status: "in_progress",
    targetUpvotes: 24,
    authorKey: "userA" as const,
  },
  {
    title: "Open Source Portfolio Builder",
    description:
      "A drag-and-drop portfolio builder for developers and designers. Import projects from GitHub, showcase skills with interactive components, and deploy with one click. Built with React and Tailwind CSS for maximum customization.",
    tags: ["portfolio", "open-source", "react", SCREENSHOT_TAG],
    status: "open",
    targetUpvotes: 18,
    authorKey: "userB" as const,
  },
  {
    title: "Community Fitness Challenge App",
    description:
      "A social fitness platform where friends create and join challenges. Track workouts, earn badges, compete on leaderboards, and celebrate milestones together. Features real-time progress tracking and team competitions.",
    tags: ["health", "mobile", "gamification", SCREENSHOT_TAG],
    status: "open",
    targetUpvotes: 31,
    authorKey: "userA" as const,
  },
  {
    title: "Real-time Markdown Collaboration Tool",
    description:
      "A Google Docs-like editor built for markdown enthusiasts. Real-time cursors, conflict-free editing with CRDTs, version history, and export to PDF/HTML. Perfect for technical documentation teams.",
    tags: ["collaboration", "markdown", "websockets", SCREENSHOT_TAG],
    status: "in_progress",
    targetUpvotes: 12,
    authorKey: "admin" as const,
  },
  {
    title: "Smart Home Energy Dashboard",
    description:
      "Track and optimize your home energy usage with AI-powered insights. Connect IoT devices, visualize consumption patterns, and get actionable recommendations to reduce your carbon footprint and energy bills.",
    tags: ["iot", "sustainability", "dashboard", SCREENSHOT_TAG],
    status: "completed",
    targetUpvotes: 42,
    authorKey: "userB" as const,
  },
];

const BOARD_TASKS = [
  // Backlog (3)
  { title: "Explore meal planning integration", column: "Backlog", labels: ["Enhancement"], assigneeKey: null, dueOffset: null, checklist: null },
  { title: "Research dietary restriction databases", column: "Backlog", labels: ["Backend"], assigneeKey: null, dueOffset: null, checklist: null },
  { title: "Investigate recipe image generation", column: "Backlog", labels: ["Enhancement"], assigneeKey: null, dueOffset: null, checklist: null },
  // To Do (4)
  { title: "Design recipe card component", column: "To Do", labels: ["Design", "Frontend"], assigneeKey: "userB" as const, dueOffset: 7, checklist: null },
  { title: "Set up Supabase schema for recipes", column: "To Do", labels: ["Backend"], assigneeKey: "userA" as const, dueOffset: 3, checklist: null },
  { title: "Create ingredient autocomplete", column: "To Do", labels: ["Frontend"], assigneeKey: "userB" as const, dueOffset: 5, checklist: null },
  { title: "Build nutrition calculator widget", column: "To Do", labels: ["Frontend", "Backend"], assigneeKey: null, dueOffset: 10, checklist: null },
  // In Progress (4)
  { title: "Implement ingredient parser API", column: "In Progress", labels: ["Backend"], assigneeKey: "userA" as const, dueOffset: 1, checklist: { total: 3, done: 2, items: ["Parse ingredient quantities", "Handle unit conversions", "Support alternative names"] } },
  { title: "Build recipe search with filters", column: "In Progress", labels: ["Frontend", "Backend"], assigneeKey: "userB" as const, dueOffset: -1, checklist: { total: 4, done: 1, items: ["Full-text search", "Tag filtering", "Dietary filters", "Sort by rating"] } },
  { title: "Add user taste profile quiz", column: "In Progress", labels: ["Frontend"], assigneeKey: "userA" as const, dueOffset: 4, checklist: null },
  { title: "Set up real-time collaboration", column: "In Progress", labels: ["Backend"], assigneeKey: "admin" as const, dueOffset: 6, checklist: null },
  // Review (3)
  { title: "Add user preference onboarding flow", column: "Review", labels: ["Frontend", "Design"], assigneeKey: "userA" as const, dueOffset: 5, checklist: { total: 2, done: 2, items: ["Onboarding wizard UI", "Save preferences to DB"] } },
  { title: "Implement grocery list export", column: "Review", labels: ["Backend"], assigneeKey: "userB" as const, dueOffset: 2, checklist: null },
  { title: "Design mobile recipe view", column: "Review", labels: ["Design"], assigneeKey: "userB" as const, dueOffset: 8, checklist: null },
  // Done (4)
  { title: "Set up Next.js project structure", column: "Done", labels: [], assigneeKey: "userA" as const, dueOffset: null, checklist: null },
  { title: "Configure authentication with OAuth", column: "Done", labels: ["Backend"], assigneeKey: "userB" as const, dueOffset: null, checklist: null },
  { title: "Create CI/CD pipeline", column: "Done", labels: ["Backend"], assigneeKey: "admin" as const, dueOffset: null, checklist: null },
  { title: "Design database schema", column: "Done", labels: ["Backend", "Design"], assigneeKey: "userA" as const, dueOffset: null, checklist: null },
];

const COMMENTS = [
  {
    authorKey: "userB" as const,
    content:
      "Love this concept! Have you considered integrating with existing recipe APIs like Spoonacular? It could save months of data collection work.",
  },
  {
    authorKey: "admin" as const,
    content:
      "The AI taste profile learning sounds fascinating. Collaborative filtering would work well here, but you might also want to explore content-based filtering for new users with no history.",
  },
  {
    authorKey: "userA" as const,
    content:
      "Great suggestions! I've added Spoonacular to the technical stack. For the cold start problem, I'm thinking of using a short taste quiz during onboarding.",
  },
];

const DISCUSSION = {
  title: "API Design: REST vs GraphQL for recipe endpoints",
  body: `Before we start building the API layer, we need to decide on the architecture. The recipe data is highly relational (recipes -> ingredients -> nutritional info -> categories) which could influence our choice.

**Considerations:**
- Query flexibility for the frontend
- Caching strategy
- Real-time subscription support
- Developer experience`,
  authorKey: "userA" as const,
  replies: [
    {
      authorKey: "userB" as const,
      content:
        "I'd lean toward GraphQL here. The recipe data model is deeply nested and the frontend will need different views of the same data (card view vs detail view vs search results). With REST, we'd end up with a lot of endpoint variants or over-fetching.",
    },
    {
      authorKey: "userA" as const,
      content:
        "That's a fair point. But for the MVP, REST might be simpler to implement and debug. We could always migrate to GraphQL later if the query patterns get complex.",
    },
    {
      authorKey: "admin" as const,
      content:
        "What about tRPC since we're already in the Next.js ecosystem? It gives us end-to-end type safety without the GraphQL schema overhead, and we can still use Supabase's real-time subscriptions directly.",
      parentIndex: 0, // nested under first reply
    },
  ],
};

const BOT_AGENTS = [
  { name: "CodeReviewer", role: "Code Review", bio: "Automated code review specialist focusing on TypeScript best practices and performance", skills: ["typescript", "code-review", "performance"] },
  { name: "DevPlanner", role: "Developer", bio: "Full-stack development agent for Next.js and Supabase projects", skills: ["nextjs", "supabase", "react", "planning"] },
  { name: "QA Tester", role: "QA", bio: "Quality assurance agent that designs test plans and catches edge cases", skills: ["testing", "playwright", "edge-cases"] },
];

// ── Seeding ──

export async function seedRealisticData(): Promise<SeededData> {
  // 0. Clean up any leftover data from previous failed runs
  await cleanupByTag();

  // 1. Look up test user IDs
  const userAId = await getTestUserId("userA");
  const userBId = await getTestUserId("userB");
  const adminId = await getTestUserId("admin");
  const userIds = { userA: userAId, userB: userBId, admin: adminId };
  _userIds = userIds;

  const userIdByKey: Record<string, string> = {
    userA: userAId,
    userB: userBId,
    admin: adminId,
  };

  // 2. Capture original user names BEFORE any mutation
  const { data: originalUsers } = await supabaseAdmin
    .from("users")
    .select("id, full_name")
    .in("id", [userAId, userBId, adminId]);

  const originalNames: Record<string, string> = {};
  for (const u of originalUsers ?? []) {
    originalNames[u.id] = u.full_name ?? "";
  }
  _originalNames = { ...originalNames };

  // 3. Rename users to realistic names + set profile fields on userA
  await supabaseAdmin.from("users").update({ full_name: "Alex Rivera", bio: "Full-stack developer passionate about AI and food tech", contact_info: "alex@example.com" }).eq("id", userAId);
  await supabaseAdmin.from("users").update({ full_name: "Sarah Chen" }).eq("id", userBId);
  await supabaseAdmin.from("users").update({ full_name: "Marcus Johnson" }).eq("id", adminId);

  // 4. Create ideas
  const ideaIds: string[] = [];
  let primaryIdeaId = "";

  for (const idea of IDEAS) {
    const { data, error } = await supabaseAdmin
      .from("ideas")
      .insert({
        title: idea.title,
        description: idea.description,
        tags: idea.tags,
        status: idea.status,
        author_id: userIdByKey[idea.authorKey],
        created_at: THREE_DAYS_AGO,
        visibility: "public",
      })
      .select("id")
      .single();

    if (error) throw new Error(`Failed to create idea "${idea.title}": ${error.message}`);
    ideaIds.push(data.id);
    if (idea.title === "AI-Powered Recipe Generator") primaryIdeaId = data.id;
  }

  // 5. Add collaborators
  await addCollaborator(primaryIdeaId, userBId);
  await addCollaborator(primaryIdeaId, adminId);
  await addCollaborator(ideaIds[1], userAId); // Portfolio Builder
  await addCollaborator(ideaIds[3], userAId); // Markdown Tool

  // 6. Insert votes + set target upvote counts
  for (const [i, idea] of IDEAS.entries()) {
    // Insert real votes from all 3 users
    for (const uid of [userAId, userBId, adminId]) {
      await supabaseAdmin.from("votes").insert({ idea_id: ideaIds[i], user_id: uid }).select();
    }
    // Override denormalized count to target number
    await supabaseAdmin.from("ideas").update({ upvotes: idea.targetUpvotes }).eq("id", ideaIds[i]);
  }

  // 7. Verify vote counts
  for (const [i, idea] of IDEAS.entries()) {
    const { data } = await supabaseAdmin.from("ideas").select("upvotes").eq("id", ideaIds[i]).single();
    if (data?.upvotes !== idea.targetUpvotes) {
      console.warn(`Vote count mismatch for "${idea.title}": got ${data?.upvotes}, expected ${idea.targetUpvotes}`);
    }
  }

  // 8. Create board columns for primary idea
  const columnDefs = [
    { title: "Backlog", position: 1000, is_done_column: false },
    { title: "To Do", position: 2000, is_done_column: false },
    { title: "In Progress", position: 3000, is_done_column: false },
    { title: "Review", position: 4000, is_done_column: false },
    { title: "Done", position: 5000, is_done_column: true },
  ];

  const { data: columns, error: colErr } = await supabaseAdmin
    .from("board_columns")
    .insert(columnDefs.map((c) => ({ ...c, idea_id: primaryIdeaId })))
    .select();
  if (colErr) throw new Error(`Failed to create columns: ${colErr.message}`);

  const columnIds: Record<string, string> = {};
  for (const col of columns) {
    columnIds[col.title] = col.id;
  }

  // 9. Create labels
  const labelDefs = [
    { name: "Frontend", color: "blue" },
    { name: "Backend", color: "green" },
    { name: "Design", color: "violet" },
    { name: "Bug", color: "red" },
    { name: "Enhancement", color: "amber" },
  ];

  const { data: labels, error: labelErr } = await supabaseAdmin
    .from("board_labels")
    .insert(labelDefs.map((l) => ({ ...l, idea_id: primaryIdeaId })))
    .select();
  if (labelErr) throw new Error(`Failed to create labels: ${labelErr.message}`);

  const labelIds = labels.map((l) => l.id);
  const labelIdByName: Record<string, string> = {};
  for (const l of labels) {
    labelIdByName[l.name] = l.id;
  }

  // 10. Create tasks
  const taskIds: string[] = [];
  for (const [i, task] of BOARD_TASKS.entries()) {
    const dueDate = task.dueOffset !== null
      ? new Date(Date.now() + task.dueOffset * 24 * 60 * 60 * 1000).toISOString().split("T")[0]
      : null;

    const { data, error } = await supabaseAdmin
      .from("board_tasks")
      .insert({
        idea_id: primaryIdeaId,
        column_id: columnIds[task.column],
        title: task.title,
        description: `Implementation details for: ${task.title}`,
        position: (i + 1) * 1000,
        assignee_id: task.assigneeKey ? userIdByKey[task.assigneeKey] : null,
        due_date: dueDate,
      })
      .select("id")
      .single();

    if (error) throw new Error(`Failed to create task "${task.title}": ${error.message}`);
    taskIds.push(data.id);

    // Assign labels to task
    for (const labelName of task.labels) {
      if (labelIdByName[labelName]) {
        await supabaseAdmin.from("board_task_labels").insert({
          task_id: data.id,
          label_id: labelIdByName[labelName],
        });
      }
    }

    // Create checklist items
    if (task.checklist) {
      for (const [ci, itemTitle] of task.checklist.items.entries()) {
        await supabaseAdmin.from("board_checklist_items").insert({
          task_id: data.id,
          title: itemTitle,
          position: (ci + 1) * 1000,
          completed: ci < task.checklist.done,
        });
      }
    }
  }

  // 11. Create comments on primary idea
  const commentIds: string[] = [];
  for (const comment of COMMENTS) {
    const { data, error } = await supabaseAdmin
      .from("comments")
      .insert({
        idea_id: primaryIdeaId,
        author_id: userIdByKey[comment.authorKey],
        content: comment.content,
        type: "comment",
        created_at: THREE_DAYS_AGO,
      })
      .select("id")
      .single();

    if (error) throw new Error(`Failed to create comment: ${error.message}`);
    commentIds.push(data.id);
  }

  // 12. Create discussion
  const { data: discussion, error: discErr } = await supabaseAdmin
    .from("idea_discussions")
    .insert({
      idea_id: primaryIdeaId,
      author_id: userIdByKey[DISCUSSION.authorKey],
      title: DISCUSSION.title,
      body: DISCUSSION.body,
      status: "open",
      pinned: false,
      created_at: THREE_DAYS_AGO,
    })
    .select("id")
    .single();
  if (discErr) throw new Error(`Failed to create discussion: ${discErr.message}`);

  // 13. Create discussion replies
  const discussionReplyIds: string[] = [];
  for (const reply of DISCUSSION.replies) {
    const parentId = reply.parentIndex !== undefined ? discussionReplyIds[reply.parentIndex] : null;

    const { data, error } = await supabaseAdmin
      .from("idea_discussion_replies")
      .insert({
        discussion_id: discussion.id,
        author_id: userIdByKey[reply.authorKey],
        content: reply.content,
        parent_reply_id: parentId,
        created_at: THREE_DAYS_AGO,
      })
      .select("id")
      .single();

    if (error) throw new Error(`Failed to create reply: ${error.message}`);
    discussionReplyIds.push(data.id);
  }

  // 14. Create bot agents
  const botIds: string[] = [];
  for (const bot of BOT_AGENTS) {
    const { data: botId, error: botErr } = await supabaseAdmin.rpc("create_bot_user", {
      p_name: bot.name,
      p_owner_id: userAId,
      p_role: bot.role,
      p_system_prompt: null,
      p_avatar_url: null,
    });

    if (botErr) throw new Error(`Failed to create bot "${bot.name}": ${botErr.message}`);

    // Follow-up UPDATE for bio and skills
    await supabaseAdmin
      .from("bot_profiles")
      .update({ bio: bot.bio, skills: bot.skills })
      .eq("id", botId);

    botIds.push(botId);
  }

  // 15. Allocate first bot to primary idea's agent pool
  await supabaseAdmin.from("idea_agents").insert({
    idea_id: primaryIdeaId,
    bot_id: botIds[0],
    added_by: userAId,
  });

  return {
    userIds,
    originalNames,
    ideaIds,
    primaryIdeaId,
    columnIds,
    taskIds,
    labelIds,
    commentIds,
    discussionId: discussion.id,
    discussionReplyIds,
    botIds,
  };
}

// ── Cleanup ──

async function cleanupByTag() {
  // Delete any ideas with the screenshot-seed tag from previous failed runs
  const { data: staleIdeas } = await supabaseAdmin
    .from("ideas")
    .select("id")
    .contains("tags", [SCREENSHOT_TAG]);

  if (staleIdeas && staleIdeas.length > 0) {
    await supabaseAdmin.from("ideas").delete().in("id", staleIdeas.map((i) => i.id));
  }

  // Clean up any leftover screenshot bots
  const { data: staleBots } = await supabaseAdmin
    .from("bot_profiles")
    .select("id, name")
    .in("name", BOT_AGENTS.map((b) => b.name));

  if (staleBots && staleBots.length > 0) {
    for (const bot of staleBots) {
      try {
        await supabaseAdmin.rpc("admin_delete_bot_user", { p_bot_id: bot.id });
      } catch {
        // Ignore — may not exist or may have already been cleaned
      }
    }
  }
}

export async function cleanupSeededData(data: SeededData | null) {
  const errors: string[] = [];

  // 1. Always restore original user names (most critical)
  const namesToRestore = data?.originalNames ?? _originalNames;
  const ids = data?.userIds ?? _userIds;
  for (const [userId, originalName] of Object.entries(namesToRestore)) {
    try {
      await supabaseAdmin
        .from("users")
        .update({ full_name: originalName })
        .eq("id", userId);
    } catch (e) {
      errors.push(`Failed to restore name for ${userId}: ${e}`);
    }
  }

  // 2. Remove bio/contact_info from userA if set
  if (ids.userA) {
    try {
      await supabaseAdmin
        .from("users")
        .update({ bio: null, contact_info: null })
        .eq("id", ids.userA);
    } catch (e) {
      errors.push(`Failed to clear userA profile: ${e}`);
    }
  }

  // 3. Delete ideas by ID (cascades to board, comments, discussions, votes, collaborators)
  if (data?.ideaIds?.length) {
    try {
      await supabaseAdmin.from("ideas").delete().in("id", data.ideaIds);
    } catch (e) {
      errors.push(`Failed to delete ideas: ${e}`);
    }
  }

  // 4. Delete bot agents
  if (data?.botIds?.length) {
    for (const botId of data.botIds) {
      try {
        // Remove from idea_agents first
        await supabaseAdmin.from("idea_agents").delete().eq("bot_id", botId);
        await supabaseAdmin.rpc("admin_delete_bot_user", { p_bot_id: botId });
      } catch (e) {
        errors.push(`Failed to delete bot ${botId}: ${e}`);
      }
    }
  }

  // 5. Fallback tag-based cleanup
  try {
    await cleanupByTag();
  } catch (e) {
    errors.push(`Fallback tag cleanup failed: ${e}`);
  }

  if (errors.length > 0) {
    console.error("Screenshot cleanup errors:", errors);
  }
}
