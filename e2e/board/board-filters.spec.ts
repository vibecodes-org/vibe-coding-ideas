import { test, expect } from "../fixtures/auth";
import { EXPECT_TIMEOUT } from "../fixtures/constants";
import { getTestUserId, createTestIdea, createTestBoardWithTasks, cleanupIdeas, scopedTitle } from "../fixtures/test-data";

let ideaId: string;
let boardUrl: string;

test.beforeAll(async () => {
  const userId = await getTestUserId("userA");
  const idea = await createTestIdea(userId, { title: scopedTitle("Board Filters") });
  ideaId = idea.id;
  boardUrl = `/ideas/${ideaId}/board`;
  await createTestBoardWithTasks(ideaId, 3);
});

test.afterAll(async () => {
  await cleanupIdeas([ideaId]);
});

test.describe("Board Filters", () => {
  test("should search tasks by title", async ({ userAPage: page }) => {
    await page.goto(boardUrl);
    await expect(page.getByText("[E2E] Task 1")).toBeVisible({ timeout: EXPECT_TIMEOUT });

    // Type in search
    await page.getByPlaceholder("Search tasks...").fill("Task 2");

    // Only Task 2 should be visible
    await expect(page.getByText("[E2E] Task 2")).toBeVisible({ timeout: EXPECT_TIMEOUT });
    await expect(page.getByText("[E2E] Task 1")).not.toBeVisible();
    await expect(page.getByText("[E2E] Task 3")).not.toBeVisible();
  });

  test("should clear search", async ({ userAPage: page }) => {
    await page.goto(boardUrl);
    await expect(page.getByText("[E2E] Task 1")).toBeVisible({ timeout: EXPECT_TIMEOUT });

    // Search for something
    const searchInput = page.getByPlaceholder("Search tasks...");
    await searchInput.fill("Task 1");
    await expect(page.getByText("[E2E] Task 2")).not.toBeVisible();

    // Clear search
    await searchInput.clear();

    // All tasks should be visible again
    await expect(page.getByText("[E2E] Task 1")).toBeVisible({ timeout: EXPECT_TIMEOUT });
    await expect(page.getByText("[E2E] Task 2")).toBeVisible();
    await expect(page.getByText("[E2E] Task 3")).toBeVisible();
  });
});
