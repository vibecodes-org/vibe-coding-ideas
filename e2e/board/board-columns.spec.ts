import { test, expect } from "../fixtures/auth";
import { EXPECT_TIMEOUT } from "../fixtures/constants";
import { getTestUserId, createTestIdea, createTestBoardColumns, cleanupIdeas, scopedTitle } from "../fixtures/test-data";

let ideaId: string;
let boardUrl: string;

test.beforeAll(async () => {
  const userId = await getTestUserId("userA");
  const idea = await createTestIdea(userId, { title: scopedTitle("Board Columns") });
  ideaId = idea.id;
  boardUrl = `/ideas/${ideaId}/board`;
  await createTestBoardColumns(ideaId);
});

test.afterAll(async () => {
  await cleanupIdeas([ideaId]);
});

test.describe("Board Columns", () => {
  test("should display existing columns", async ({ userAPage: page }) => {
    await page.goto(boardUrl);
    await expect(page.getByText("To Do")).toBeVisible({ timeout: EXPECT_TIMEOUT });
    await expect(page.getByText("In Progress")).toBeVisible();
    await expect(page.getByText("Done")).toBeVisible();
  });

  test("should create a new column", async ({ userAPage: page }) => {
    await page.goto(boardUrl);
    await expect(page.locator("[data-testid^='column-']").first()).toBeVisible({ timeout: EXPECT_TIMEOUT });

    // Click "Add Column"
    await page.getByRole("button", { name: "Add Column" }).click();

    // Fill in column name and submit
    await page.getByPlaceholder("Column name...").fill("Testing");
    await page.getByRole("button", { name: "Add" }).click();

    // Verify the column appears
    await expect(page.getByText("Testing")).toBeVisible({ timeout: EXPECT_TIMEOUT });
  });

  test("should rename a column", async ({ userAPage: page }) => {
    await page.goto(boardUrl);
    await expect(page.getByText("To Do")).toBeVisible({ timeout: EXPECT_TIMEOUT });

    // Open column options menu on "To Do" column
    const todoColumn = page.locator("[data-testid^='column-']").filter({ hasText: "To Do" });
    await todoColumn.getByRole("button", { name: "Column options" }).click();

    // Click Edit
    await page.getByRole("menuitem", { name: "Edit" }).click();

    // Edit Column dialog should appear
    await expect(page.getByText("Edit Column")).toBeVisible({ timeout: EXPECT_TIMEOUT });

    // Clear and type new name
    const input = page.locator("#column-title");
    await input.clear();
    await input.fill("To Do (Renamed)");
    await page.getByRole("button", { name: "Save" }).click();

    // Verify renamed
    await expect(page.getByText("To Do (Renamed)")).toBeVisible({ timeout: EXPECT_TIMEOUT });
  });

  test("should delete a column", async ({ userAPage: page }) => {
    await page.goto(boardUrl);
    // The "Testing" column we created earlier should be there
    await expect(page.getByText("Testing")).toBeVisible({ timeout: EXPECT_TIMEOUT });

    // Open column options on "Testing"
    const testingColumn = page.locator("[data-testid^='column-']").filter({ hasText: "Testing" });
    await testingColumn.getByRole("button", { name: "Column options" }).click();

    // Click Delete
    await page.getByRole("menuitem", { name: "Delete" }).click();

    // Column should disappear
    await expect(page.getByText("Testing").first()).not.toBeVisible({ timeout: EXPECT_TIMEOUT });
  });
});
