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
    await expect(page.locator("[data-testid^='column-']")).toHaveCount(3, { timeout: EXPECT_TIMEOUT });
  });

  test("should create a new column", async ({ userAPage: page }) => {
    await page.goto(boardUrl);
    await expect(page.locator("[data-testid^='column-']").first()).toBeVisible({ timeout: EXPECT_TIMEOUT });

    await page.getByRole("button", { name: "Add Column" }).click();
    await page.getByPlaceholder("Column name...").fill("Testing");
    await page.getByRole("button", { name: "Add" }).click();

    await expect(page.locator("[data-testid^='column-']").filter({ hasText: "Testing" })).toBeVisible({ timeout: EXPECT_TIMEOUT });
  });

  test("should rename a column via edit dialog", async ({ userAPage: page }) => {
    await page.goto(boardUrl);
    await expect(page.locator("[data-testid^='column-']").first()).toBeVisible({ timeout: EXPECT_TIMEOUT });

    // Open column options on "To Do" column
    const todoColumn = page.locator("[data-testid^='column-']").filter({ hasText: "To Do" });
    await todoColumn.getByRole("button").filter({ has: page.locator("[class*='more-horizontal'], svg") }).last().click();

    await page.getByRole("menuitem", { name: "Edit" }).click();
    await expect(page.getByText("Edit Column")).toBeVisible({ timeout: EXPECT_TIMEOUT });

    const input = page.locator("#column-title");
    await input.clear();
    await input.fill("To Do Renamed");
    await page.getByRole("button", { name: "Save" }).click();

    await expect(page.locator("[data-testid^='column-']").filter({ hasText: "To Do Renamed" })).toBeVisible({ timeout: EXPECT_TIMEOUT });
  });
});
