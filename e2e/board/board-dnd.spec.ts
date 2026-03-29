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
  test("should drag a task to another column", async ({ userAPage: page }, testInfo) => {
    // DnD is desktop-only
    if (testInfo.project.name === "Mobile Chrome") {
      test.skip();
      return;
    }

    await page.goto(boardUrl);
    await expect(page.getByText("[E2E] Task 1")).toBeVisible({ timeout: EXPECT_TIMEOUT });

    const taskCard = page.locator("[data-testid^='task-card-']").filter({ hasText: "[E2E] Task 1" });
    const inProgressColumn = page.locator("[data-testid^='column-']").filter({ hasText: "In Progress" });

    await dragTaskToColumn(page, taskCard, inProgressColumn);
    await page.waitForTimeout(2000);

    const inProgressTasks = inProgressColumn.locator("[data-testid^='task-card-']");
    await expect(inProgressTasks.filter({ hasText: "[E2E] Task 1" })).toBeVisible({ timeout: EXPECT_TIMEOUT });
  });
});
