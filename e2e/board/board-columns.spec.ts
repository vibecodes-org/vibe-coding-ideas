import { test, expect } from "../fixtures/auth";
import { EXPECT_TIMEOUT } from "../fixtures/constants";
import { getTestUserId, createTestIdea, createTestBoardWithTasks, cleanupIdeas, scopedTitle } from "../fixtures/test-data";

let ideaId: string;
let boardUrl: string;

test.beforeAll(async () => {
  const userId = await getTestUserId("userA");
  const idea = await createTestIdea(userId, { title: scopedTitle("Board Columns") });
  ideaId = idea.id;
  boardUrl = `/ideas/${ideaId}/board`;
  // Create columns WITH tasks so the board shows columns, not the empty AI state
  await createTestBoardWithTasks(ideaId, 1);
});

test.afterAll(async () => {
  await cleanupIdeas([ideaId]);
});

test.describe("Board Columns", () => {
  test("should display existing columns", async ({ userAPage: page }) => {
    await page.goto(boardUrl);
    await expect(page.locator("[data-testid^='column-']").first()).toBeVisible({ timeout: EXPECT_TIMEOUT });
    // Board has default columns + the 3 we created, so at least 3
    const count = await page.locator("[data-testid^='column-']").count();
    expect(count).toBeGreaterThanOrEqual(3);
  });

  test("should create a new column", async ({ userAPage: page }) => {
    await page.goto(boardUrl);
    await expect(page.locator("[data-testid^='column-']").first()).toBeVisible({ timeout: EXPECT_TIMEOUT });

    await page.getByRole("button", { name: "Add Column" }).click();
    await page.getByPlaceholder("Column name...").fill("Testing");
    await page.getByRole("button", { name: "Add", exact: true }).click();

    await expect(page.locator("[data-testid^='column-']").filter({ hasText: "Testing" })).toBeVisible({ timeout: EXPECT_TIMEOUT });
  });

  test("should have column options menu with Edit and Delete", async ({ userAPage: page }) => {
    await page.goto(boardUrl);
    await expect(page.locator("[data-testid^='column-']").first()).toBeVisible({ timeout: EXPECT_TIMEOUT });

    // Find the "..." button on any column — it's the last icon-only button in the column header
    const firstColumn = page.locator("[data-testid^='column-']").first();
    // Click the MoreHorizontal button (small icon button in column header)
    const menuButtons = firstColumn.locator("button").filter({ has: page.locator("svg") });
    // The options button is typically the last svg button in the column header area
    await menuButtons.last().click();

    // Menu should show Edit and Delete options
    await expect(page.getByRole("menuitem", { name: "Edit" })).toBeVisible({ timeout: EXPECT_TIMEOUT });
  });
});
