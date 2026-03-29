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
  await createTestBoardWithTasks(ideaId, 2);
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

    // Click "Add task" on the first column
    await page.getByRole("button", { name: "Add task" }).first().click();

    // Fill in task title and create
    await page.getByPlaceholder("Task title").fill(scopedTitle("New Task"));
    await page.getByRole("button", { name: "Create" }).click();

    // Verify the task appears on the board
    await expect(page.getByText(/\[E2E\] New Task/)).toBeVisible({ timeout: EXPECT_TIMEOUT });
  });

  test("should open task detail dialog on click", async ({ userAPage: page }) => {
    await page.goto(boardUrl);
    await expect(page.getByText("[E2E] Task 1")).toBeVisible({ timeout: EXPECT_TIMEOUT });

    // Click the task card
    await page.getByText("[E2E] Task 1").click();

    // Task detail dialog should open with tabs
    await expect(page.getByRole("tab", { name: "Details" })).toBeVisible({ timeout: EXPECT_TIMEOUT });
    await expect(page.getByRole("tab", { name: "Comments" })).toBeVisible();
  });

  test("should edit task description", async ({ userAPage: page }) => {
    await page.goto(boardUrl);
    await expect(page.getByText("[E2E] Task 1")).toBeVisible({ timeout: EXPECT_TIMEOUT });
    await page.getByText("[E2E] Task 1").click();

    // Click "Add a description..." or the edit button
    const addDesc = page.getByText("Add a description...");
    const editBtn = page.getByRole("button", { name: "Edit" }).first();
    if (await addDesc.isVisible({ timeout: 3000 }).catch(() => false)) {
      await addDesc.click();
    } else {
      await editBtn.click();
    }

    // Type a description
    const descInput = page.getByPlaceholder(/Add a description/i);
    await descInput.fill("Updated description for E2E test");
    // Blur to save
    await page.keyboard.press("Tab");

    // Close and reopen to verify it saved
    await page.keyboard.press("Escape");
    await page.waitForTimeout(1000);
    await page.getByText("[E2E] Task 1").click();
    await expect(page.getByText("Updated description for E2E test")).toBeVisible({ timeout: EXPECT_TIMEOUT });
  });

  test("should archive a task", async ({ userAPage: page }) => {
    await page.goto(boardUrl);
    await expect(page.getByText("[E2E] Task 2")).toBeVisible({ timeout: EXPECT_TIMEOUT });
    await page.getByText("[E2E] Task 2").click();

    // Click Archive button in the footer
    await page.getByRole("button", { name: "Archive" }).click();

    // Task should disappear from the board (archived tasks are hidden by default)
    await page.keyboard.press("Escape");
    await page.waitForTimeout(1000);
    await expect(page.getByText("[E2E] Task 2")).not.toBeVisible({ timeout: EXPECT_TIMEOUT });
  });

  test("should delete a task", async ({ userAPage: page }) => {
    await page.goto(boardUrl);
    // Create a task to delete
    await page.getByRole("button", { name: "Add task" }).first().click();
    const deleteTitle = scopedTitle("Delete Me");
    await page.getByPlaceholder("Task title").fill(deleteTitle);
    await page.getByRole("button", { name: "Create" }).click();
    await expect(page.getByText(deleteTitle)).toBeVisible({ timeout: EXPECT_TIMEOUT });

    // Open the task
    await page.getByText(deleteTitle).click();
    await expect(page.getByRole("tab", { name: "Details" })).toBeVisible({ timeout: EXPECT_TIMEOUT });

    // Click Delete task (first click shows "Are you sure?")
    await page.getByRole("button", { name: "Delete task" }).click();
    // Confirm deletion
    await page.getByRole("button", { name: "Are you sure?" }).click();

    // Task should be gone
    await page.waitForTimeout(1000);
    await expect(page.getByText(deleteTitle)).not.toBeVisible({ timeout: EXPECT_TIMEOUT });
  });
});
