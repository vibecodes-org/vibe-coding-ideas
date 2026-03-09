import { test, expect } from "../fixtures/auth";
import {
  createTestIdea,
  createTestBoardWithTasks,
  addCollaborator,
  cleanupIdeas,
} from "../fixtures/test-data";
import { supabaseAdmin } from "../fixtures/supabase-admin";

async function getUserId(fullName: string): Promise<string> {
  const { data } = await supabaseAdmin
    .from("users")
    .select("id")
    .eq("full_name", fullName)
    .single();
  if (!data) throw new Error(`Test user not found: ${fullName}`);
  return data.id;
}

let userAId: string;
let userBId: string;
let ideaId: string;
let boardIdeaId: string;
let collabIdeaId: string;

test.beforeAll(async () => {
  userAId = await getUserId("Test User A");
  userBId = await getUserId("Test User B");

  // Idea owned by User A (for My Ideas section)
  const idea = await createTestIdea(userAId, {
    title: "[E2E] Dashboard My Idea",
    description: "[E2E] An idea for the dashboard test.",
    tags: ["e2e-test"],
  });
  ideaId = idea.id;

  // Idea with board and tasks (for Active Boards, My Tasks)
  const boardIdea = await createTestIdea(userAId, {
    title: "[E2E] Dashboard Board Idea",
    description: "[E2E] An idea with a board for dashboard tests.",
  });
  boardIdeaId = boardIdea.id;
  const { tasks } = await createTestBoardWithTasks(boardIdeaId, 2);

  // Assign a task to User A so it appears in My Tasks
  await supabaseAdmin
    .from("board_tasks")
    .update({ assignee_id: userAId })
    .eq("id", tasks[0].id);

  // Idea owned by User B where User A is a collaborator (for Collaborations section)
  const collabIdea = await createTestIdea(userBId, {
    title: "[E2E] Dashboard Collab Idea",
    description: "[E2E] An idea User A collaborates on.",
  });
  collabIdeaId = collabIdea.id;
  await addCollaborator(collabIdeaId, userAId);

  // Create a notification for User A (for Recent Activity section)
  await supabaseAdmin.from("notifications").insert({
    user_id: userAId,
    actor_id: userBId,
    type: "vote",
    idea_id: ideaId,
    read: false,
  });
});

test.afterAll(async () => {
  // Clean up notifications seeded for this suite
  await supabaseAdmin
    .from("notifications")
    .delete()
    .eq("idea_id", ideaId)
    .eq("actor_id", userBId);
  await cleanupIdeas([ideaId, boardIdeaId, collabIdeaId]);
});

test.describe("Dashboard", () => {
  // Bump updated_at before each test so our ideas appear in the top 5
  // (dashboard limits to 5 most recent — parallel workers create other ideas)
  test.beforeEach(async () => {
    await supabaseAdmin
      .from("ideas")
      .update({ updated_at: new Date().toISOString() })
      .in("id", [ideaId, boardIdeaId, collabIdeaId].filter(Boolean));
  });

  test("stats cards show counts with numbers", async ({ userAPage }) => {
    await userAPage.goto("/dashboard");

    // Wait for the dashboard heading to confirm page has loaded
    await expect(userAPage.getByRole("heading", { name: /dashboard/i })).toBeVisible({ timeout: 15_000 });

    // All four stats cards should be visible
    const ideasCreated = userAPage.locator('[data-testid="stats-ideas-created"]');
    await expect(ideasCreated).toBeVisible({ timeout: 15_000 });
    // The card should contain a number (the value)
    await expect(ideasCreated.locator("p.text-2xl")).toHaveText(/\d+/);

    const collaborations = userAPage.locator('[data-testid="stats-collaborations"]');
    await expect(collaborations).toBeVisible();
    await expect(collaborations.locator("p.text-2xl")).toHaveText(/\d+/);

    const upvotes = userAPage.locator('[data-testid="stats-upvotes-received"]');
    await expect(upvotes).toBeVisible();
    await expect(upvotes.locator("p.text-2xl")).toHaveText(/\d+/);

    const tasksAssigned = userAPage.locator('[data-testid="stats-tasks-assigned"]');
    await expect(tasksAssigned).toBeVisible();
    await expect(tasksAssigned.locator("p.text-2xl")).toHaveText(/\d+/);
  });

  test("welcome card shown for fresh user with 0 ideas", async ({ freshPage }) => {
    await freshPage.goto("/dashboard");

    // Wait for the dashboard to load — freshPage may need extra time
    await freshPage.waitForLoadState("domcontentloaded");

    // Fresh user may be redirected to login if auth is not established
    // Check if we're on the dashboard first
    const url = freshPage.url();
    if (url.includes("/login")) {
      test.skip(true, "freshPage auth not established — session may have expired");
      return;
    }

    // Wait for the dashboard heading to confirm page has loaded
    await expect(freshPage.getByRole("heading", { name: /dashboard/i })).toBeVisible({ timeout: 15_000 });

    // Welcome card should be visible (may render in both columns on desktop)
    await expect(
      freshPage.getByText("Welcome to VibeCodes!").first()
    ).toBeVisible({ timeout: 15_000 });

    // Should have a "Create your first idea" button (may appear in welcome card + My Ideas section)
    await expect(
      freshPage.getByRole("link", { name: /create your first idea/i }).first()
    ).toBeVisible();

    // Should have a "Browse the feed" button (may appear in multiple sections)
    await expect(
      freshPage.getByRole("link", { name: /browse the feed/i }).first()
    ).toBeVisible();
  });

  test("My Ideas section shows idea cards", async ({ userAPage }) => {
    await userAPage.goto("/dashboard");
    await expect(userAPage.getByRole("heading", { name: /dashboard/i })).toBeVisible({ timeout: 15_000 });

    const myIdeasSection = userAPage.locator('[data-testid="section-my-ideas"]');
    await expect(myIdeasSection).toBeVisible({ timeout: 15_000 });

    // Should contain the seeded idea title (wait for data to render)
    await expect(
      myIdeasSection.getByText("[E2E] Dashboard My Idea")
    ).toBeVisible({ timeout: 15_000 });
  });

  test("My Tasks section shows assigned tasks", async ({ userAPage }) => {
    await userAPage.goto("/dashboard");
    await expect(userAPage.getByRole("heading", { name: /dashboard/i })).toBeVisible({ timeout: 15_000 });

    const myTasksSection = userAPage.locator('[data-testid="section-my-tasks"]');
    await expect(myTasksSection).toBeVisible({ timeout: 15_000 });

    // Should contain one of the seeded tasks (wait for data to render)
    await expect(
      myTasksSection.getByText("[E2E] Task 1")
    ).toBeVisible({ timeout: 15_000 });
  });

  test("Active Boards section shows boards with tasks", async ({ userAPage }) => {
    await userAPage.goto("/dashboard");
    await expect(userAPage.getByRole("heading", { name: /dashboard/i })).toBeVisible({ timeout: 15_000 });

    const activeBoardsSection = userAPage.locator('[data-testid="section-active-boards"]');
    await expect(activeBoardsSection).toBeVisible({ timeout: 15_000 });

    // Should contain the board idea title (wait for data to render)
    await expect(
      activeBoardsSection.getByText("[E2E] Dashboard Board Idea")
    ).toBeVisible({ timeout: 15_000 });

    // Should show task count
    await expect(
      activeBoardsSection.getByText(/2 tasks/)
    ).toBeVisible({ timeout: 15_000 });
  });

  test("Collaborations section shows ideas user collaborates on", async ({
    userAPage,
  }) => {
    await userAPage.goto("/dashboard");
    await expect(userAPage.getByRole("heading", { name: /dashboard/i })).toBeVisible({ timeout: 15_000 });

    const collabSection = userAPage.locator('[data-testid="section-collaborations"]');
    await expect(collabSection).toBeVisible({ timeout: 15_000 });

    // Should contain the collaboration idea
    await expect(
      collabSection.getByText("[E2E] Dashboard Collab Idea")
    ).toBeVisible();
  });

  test("Recent Activity section shows notifications", async ({ userAPage }) => {
    await userAPage.goto("/dashboard");
    await expect(userAPage.getByRole("heading", { name: /dashboard/i })).toBeVisible({ timeout: 15_000 });

    // Dashboard uses two-column layout; section may appear in both — use first()
    const activitySection = userAPage.locator('[data-testid="section-recent-activity"]').first();
    await expect(activitySection).toBeVisible({ timeout: 15_000 });

    // The activity feed is populated from notifications.
    // Should show notification(s) from Test User B (may be multiple from previous test runs)
    await expect(activitySection.getByText("Test User B").first()).toBeVisible({ timeout: 10_000 });
    await expect(activitySection.getByText(/voted/i).first()).toBeVisible({ timeout: 10_000 });
  });

  test("collapse and expand a section", async ({ userAPage }) => {
    // Reset collapse state from any prior test failure
    await userAPage.goto("/dashboard");
    await userAPage.evaluate(() =>
      localStorage.removeItem("dashboard-collapsed-my-ideas")
    );
    await userAPage.reload();
    await expect(userAPage.getByRole("heading", { name: /dashboard/i })).toBeVisible({ timeout: 15_000 });

    const myIdeasSection = userAPage.locator('[data-testid="section-my-ideas"]');
    await expect(myIdeasSection).toBeVisible({ timeout: 15_000 });

    // Content should be visible initially
    const content = myIdeasSection.locator("#section-my-ideas");
    await expect(content).toBeVisible();

    // Click the chevron/toggle button to collapse
    const toggleButton = myIdeasSection.locator('button[aria-expanded="true"]');
    await toggleButton.click();

    // Content should be hidden
    await expect(content).toBeHidden();

    // Click again to expand
    const collapsedButton = myIdeasSection.locator('button[aria-expanded="false"]');
    await collapsedButton.click();

    // Content should be visible again
    await expect(content).toBeVisible();
  });

  test("collapse state persists in localStorage across reload", async ({
    userAPage,
  }) => {
    // Reset collapse state from any prior test failure
    await userAPage.goto("/dashboard");
    await userAPage.evaluate(() =>
      localStorage.removeItem("dashboard-collapsed-my-ideas")
    );
    await userAPage.reload();
    await expect(userAPage.getByRole("heading", { name: /dashboard/i })).toBeVisible({ timeout: 15_000 });

    const myIdeasSection = userAPage.locator('[data-testid="section-my-ideas"]');
    await expect(myIdeasSection).toBeVisible({ timeout: 15_000 });

    // Collapse the section
    const toggleButton = myIdeasSection.locator('button[aria-expanded="true"]');
    await toggleButton.click();

    // Verify localStorage was set
    const storedValue = await userAPage.evaluate(() =>
      localStorage.getItem("dashboard-collapsed-my-ideas")
    );
    expect(storedValue).toBe("false");

    // Reload the page
    await userAPage.reload();

    // Wait for the dashboard to load after reload
    await expect(userAPage.getByRole("heading", { name: /dashboard/i })).toBeVisible({ timeout: 15_000 });

    // Section should still be collapsed after reload
    const sectionAfterReload = userAPage.locator('[data-testid="section-my-ideas"]');
    await expect(sectionAfterReload).toBeVisible({ timeout: 15_000 });

    const contentAfterReload = sectionAfterReload.locator("#section-my-ideas");
    await expect(contentAfterReload).toBeHidden();

    // Clean up: expand the section again and clear localStorage
    const collapsedButton = sectionAfterReload.locator('button[aria-expanded="false"]');
    await collapsedButton.click();
    await userAPage.evaluate(() =>
      localStorage.removeItem("dashboard-collapsed-my-ideas")
    );
  });
});
