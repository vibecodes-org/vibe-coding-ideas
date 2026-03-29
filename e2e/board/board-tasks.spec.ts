import { test, expect } from "../fixtures/auth";
import { EXPECT_TIMEOUT } from "../fixtures/constants";
import { getTestUserId, createTestIdea, createTestBoardWithTasks, cleanupIdeas, scopedTitle } from "../fixtures/test-data";

let ideaId: string;
let boardUrl: string;

test.beforeAll(async () => {
  const userId = await getTestUserId("userA");
  const idea = await createTestIdea(userId, { title: scopedTitle("Board Tasks") });
  ideaId = idea.id;
  boardUrl = `/ideas/${ideaId}/board`;
  await createTestBoardWithTasks(ideaId, 3);
});

test.afterAll(async () => {
  await cleanupIdeas([ideaId]);
});

test.describe("Board Tasks", () => {
  test("should display existing tasks on the board", async ({ userAPage: page }) => {
    await page.goto(boardUrl);
    await expect(page.locator("[data-testid^='task-card-']").first()).toBeVisible({ timeout: EXPECT_TIMEOUT });
    await expect(page.getByText("[E2E] Task 1")).toBeVisible();
    await expect(page.getByText("[E2E] Task 2")).toBeVisible();
  });

  test("should create a new task via Add task button", async ({ userAPage: page }) => {
    await page.goto(boardUrl);
    await expect(page.locator("[data-testid^='column-']").first()).toBeVisible({ timeout: EXPECT_TIMEOUT });

    await page.getByRole("button", { name: "Add task" }).first().click();
    const newTitle = scopedTitle("New Task");
    await page.getByPlaceholder("Task title").fill(newTitle);
    await page.getByRole("button", { name: "Create" }).click();

    await expect(page.getByText(newTitle)).toBeVisible({ timeout: EXPECT_TIMEOUT });
  });

  test("should open task detail dialog on click", async ({ userAPage: page }) => {
    await page.goto(boardUrl);
    await expect(page.getByText("[E2E] Task 1")).toBeVisible({ timeout: EXPECT_TIMEOUT });

    await page.getByText("[E2E] Task 1").click();
    await expect(page.getByRole("tab", { name: "Details" })).toBeVisible({ timeout: EXPECT_TIMEOUT });
    await expect(page.getByRole("tab", { name: "Comments" })).toBeVisible();
  });

  test("should edit task description", async ({ userAPage: page }) => {
    await page.goto(boardUrl);
    await expect(page.getByText("[E2E] Task 1")).toBeVisible({ timeout: EXPECT_TIMEOUT });
    await page.getByText("[E2E] Task 1").click();
    await expect(page.getByRole("tab", { name: "Details" })).toBeVisible({ timeout: EXPECT_TIMEOUT });

    // Click the Edit button next to Description
    const descSection = page.getByText("Description").locator("..");
    await descSection.getByRole("button", { name: /Edit/i }).click();

    // Find the textarea and update it
    const textarea = page.locator("textarea").filter({ hasText: /description|E2E/i }).or(
      page.getByPlaceholder(/description/i)
    ).first();
    await textarea.clear();
    await textarea.fill("Updated description for E2E test");
    // Blur to save
    await page.keyboard.press("Tab");
    await page.waitForTimeout(1000);

    // Verify saved
    await expect(page.getByText("Updated description for E2E test")).toBeVisible({ timeout: EXPECT_TIMEOUT });
  });

  test("should archive a task", async ({ userAPage: page }) => {
    await page.goto(boardUrl);
    await expect(page.getByText("[E2E] Task 2")).toBeVisible({ timeout: EXPECT_TIMEOUT });
    await page.getByText("[E2E] Task 2").click();

    await page.getByRole("button", { name: "Archive" }).click();
    await page.keyboard.press("Escape");
    await page.waitForTimeout(1000);
    await expect(page.getByText("[E2E] Task 2")).not.toBeVisible({ timeout: EXPECT_TIMEOUT });
  });

  test("should delete a task", async ({ userAPage: page }) => {
    await page.goto(boardUrl);
    await expect(page.locator("[data-testid^='column-']").first()).toBeVisible({ timeout: EXPECT_TIMEOUT });

    // Create a task to delete
    await page.getByRole("button", { name: "Add task" }).first().click();
    const deleteTitle = scopedTitle("Delete Me");
    await page.getByPlaceholder("Task title").fill(deleteTitle);
    await page.getByRole("button", { name: "Create" }).click();
    await expect(page.getByText(deleteTitle)).toBeVisible({ timeout: EXPECT_TIMEOUT });

    // Open the task
    await page.getByText(deleteTitle).click();
    await expect(page.getByRole("tab", { name: "Details" })).toBeVisible({ timeout: EXPECT_TIMEOUT });

    // Click Delete task — first click shows confirmation text
    await page.getByRole("button", { name: /Delete task/i }).click();
    // Wait for confirmation state and click again
    await page.waitForTimeout(500);
    await page.getByRole("button", { name: /Are you sure|Delete task/i }).last().click();

    await page.waitForTimeout(1000);
    await expect(page.getByText(deleteTitle)).not.toBeVisible({ timeout: EXPECT_TIMEOUT });
  });
});
