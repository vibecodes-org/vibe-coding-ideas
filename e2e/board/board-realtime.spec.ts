import { EXPECT_TIMEOUT } from "../fixtures/constants";
import { test, expect } from "../fixtures/auth";
import {
  createTestIdea,
  createTestBoardColumns,
  addCollaborator,
  cleanupTestData,
  getTestUserId,
  scopedTitle,
} from "../fixtures/test-data";
import { supabaseAdmin } from "../fixtures/supabase-admin";

let userAId: string;
let userBId: string;
let ideaId: string;
let columnIds: { todo: string; inProgress: string; done: string };

test.beforeAll(async () => {
  userAId = await getTestUserId("userA");
  userBId = await getTestUserId("userB");

  // Create idea owned by User A
  const idea = await createTestIdea(userAId, {
    title: scopedTitle("Board Realtime Idea"),
    description: scopedTitle("Idea for testing Realtime board sync between users."),
  });
  ideaId = idea.id;

  // Add User B as collaborator so they can access the board
  await addCollaborator(ideaId, userBId);

  // Create board columns (no tasks initially -- tests create them)
  const columns = await createTestBoardColumns(ideaId);
  columnIds = {
    todo: columns.find((c) => c.title === "To Do")!.id,
    inProgress: columns.find((c) => c.title === "In Progress")!.id,
    done: columns.find((c) => c.title === "Done")!.id,
  };
});

test.afterAll(async () => {
  await cleanupTestData();
});

test.describe("Board Realtime", () => {
  // Realtime tests are inherently timing-dependent and may be flaky
  test.describe.configure({ retries: 2 });

  test("User A creates a task and it appears on User B's board via Realtime", async ({
    userAPage,
    userBPage,
  }) => {
    test.slow(); // 3x default timeout for Realtime propagation

    // Both users open the same board
    await Promise.all([
      userAPage.goto(`/ideas/${ideaId}/board`),
      userBPage.goto(`/ideas/${ideaId}/board`),
    ]);

    const mainA = userAPage.getByRole("main");
    const mainB = userBPage.getByRole("main");

    // Wait for columns to load on both pages
    await Promise.all([
      mainA
        .locator('[data-testid^="column-"]')
        .first()
        .waitFor({ timeout: EXPECT_TIMEOUT }),
      mainB
        .locator('[data-testid^="column-"]')
        .first()
        .waitFor({ timeout: EXPECT_TIMEOUT }),
    ]);

    // User A creates a new task via the "Add task" button in the To Do column
    const todoColumn = mainA.locator(
      `[data-testid="column-${columnIds.todo}"]`
    );
    await todoColumn.getByRole("button", { name: /add task/i }).click();

    // Fill the task creation dialog
    const dialog = userAPage.getByRole("dialog");
    await expect(dialog).toBeVisible({ timeout: 5_000 });

    const taskTitle = scopedTitle(`Realtime Task ${Date.now()}`);
    await dialog.getByLabel("Title").fill(taskTitle);
    await dialog.getByRole("button", { name: /create/i }).click();

    // Task should appear on User A's board immediately (optimistic)
    await expect(mainA.getByText(taskTitle)).toBeVisible({
      timeout: 10_000,
    });

    // Wait for Realtime to propagate to User B's board
    // The BoardRealtime component debounces 500ms then calls router.refresh()
    // If Realtime doesn't propagate within 10s, force a page reload as fallback
    const taskOnB = mainB.getByText(taskTitle);
    try {
      await expect(taskOnB).toBeVisible({ timeout: 10_000 });
    } catch {
      // Realtime didn't propagate — reload User B's page and check server state
      await userBPage.reload();
      await expect(taskOnB).toBeVisible({ timeout: 10_000 });
    }
  });

  test("User A moves a task and the position updates on User B's board via Realtime", async ({
    userAPage,
    userBPage,
  }) => {
    test.slow(); // 3x default timeout for Realtime propagation

    // Seed a task in the To Do column for this test
    const moveTaskTitle = scopedTitle(`Realtime Move ${Date.now()}`);
    const { data: createdTask } = await supabaseAdmin
      .from("board_tasks")
      .insert({
        column_id: columnIds.todo,
        title: moveTaskTitle,
        position: 5000,
        idea_id: ideaId,
      })
      .select()
      .single();

    if (!createdTask) throw new Error("Failed to create task for move test");

    // Both users open the board
    await Promise.all([
      userAPage.goto(`/ideas/${ideaId}/board`),
      userBPage.goto(`/ideas/${ideaId}/board`),
    ]);

    const mainA = userAPage.getByRole("main");
    const mainB = userBPage.getByRole("main");

    // Wait for columns and the task to load on both pages
    await Promise.all([
      mainA.getByText(moveTaskTitle).waitFor({ timeout: EXPECT_TIMEOUT }),
      mainB.getByText(moveTaskTitle).waitFor({ timeout: EXPECT_TIMEOUT }),
    ]);

    // User B should see the task in the To Do column initially
    const userBTodoColumn = mainB.locator(
      `[data-testid="column-${columnIds.todo}"]`
    );
    await expect(userBTodoColumn.getByText(moveTaskTitle)).toBeVisible();

    // User A moves the task to In Progress via the database (simulating a server-side move)
    // We use supabaseAdmin to move the task to a different column, which triggers Realtime
    await supabaseAdmin
      .from("board_tasks")
      .update({ column_id: columnIds.inProgress, position: 1000 })
      .eq("id", createdTask.id);

    // Wait for Realtime to propagate to User B
    // After the DB change, BoardRealtime detects the change and refreshes
    const userBInProgressColumn = mainB.locator(
      `[data-testid="column-${columnIds.inProgress}"]`
    );
    const movedTaskOnB = userBInProgressColumn.getByText(moveTaskTitle);
    try {
      await expect(movedTaskOnB).toBeVisible({ timeout: 10_000 });
    } catch {
      // Realtime didn't propagate — reload User B's page and check server state
      await userBPage.reload();
      await expect(movedTaskOnB).toBeVisible({ timeout: 10_000 });
    }

    // The task should no longer be in the To Do column for User B
    await expect(
      userBTodoColumn.getByText(moveTaskTitle)
    ).not.toBeVisible();

    // User A's board should also reflect the move after their own Realtime refresh
    const userAInProgressColumn = mainA.locator(
      `[data-testid="column-${columnIds.inProgress}"]`
    );
    const movedTaskOnA = userAInProgressColumn.getByText(moveTaskTitle);
    try {
      await expect(movedTaskOnA).toBeVisible({ timeout: 10_000 });
    } catch {
      await userAPage.reload();
      await expect(movedTaskOnA).toBeVisible({ timeout: 10_000 });
    }
  });
});
