import { test, expect } from "../fixtures/auth";
import { EXPECT_TIMEOUT } from "../fixtures/constants";
import { getTestUserId, createTestIdea, createTestBoardWithTasks, cleanupIdeas, scopedTitle } from "../fixtures/test-data";
import { dragTaskToColumn } from "../helpers/board-dnd";

let ideaId: string;
let boardUrl: string;

test.beforeAll(async () => {
  const userId = await getTestUserId("userA");
  const idea = await createTestIdea(userId, { title: scopedTitle("Board DnD") });
  ideaId = idea.id;
  boardUrl = `/ideas/${ideaId}/board`;
  await createTestBoardWithTasks(ideaId, 2);
});

test.afterAll(async () => {
  await cleanupIdeas([ideaId]);
});

test.describe("Board Drag and Drop", () => {
  // DnD is desktop-only — skip on mobile
  test.skip(({}, testInfo) => testInfo.project.name === "Mobile Chrome", "DnD not available on mobile");

  test("should drag a task to another column", async ({ userAPage: page }) => {
    await page.goto(boardUrl);
    await expect(page.getByText("[E2E] Task 1")).toBeVisible({ timeout: EXPECT_TIMEOUT });

    // Get the task card and the "In Progress" column
    const taskCard = page.locator("[data-testid^='task-card-']").filter({ hasText: "[E2E] Task 1" });
    const inProgressColumn = page.locator("[data-testid^='column-']").filter({ hasText: "In Progress" });

    // Drag task to In Progress
    await dragTaskToColumn(page, taskCard, inProgressColumn);

    // Wait for the move to take effect
    await page.waitForTimeout(2000);

    // Verify the task is now in the In Progress column
    const inProgressTasks = inProgressColumn.locator("[data-testid^='task-card-']");
    await expect(inProgressTasks.filter({ hasText: "[E2E] Task 1" })).toBeVisible({ timeout: EXPECT_TIMEOUT });
  });
});
