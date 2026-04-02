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

  test("should view task description in detail dialog", async ({ userAPage: page }) => {
    await page.goto(boardUrl);
    await expect(page.getByText("[E2E] Task 1")).toBeVisible({ timeout: EXPECT_TIMEOUT });
    await page.getByText("[E2E] Task 1").click();
    await expect(page.getByRole("tab", { name: "Details" })).toBeVisible({ timeout: EXPECT_TIMEOUT });

    // The task description should be visible inside the dialog
    const dialog = page.getByLabel("Task Details");
    await expect(dialog.getByText("Task 1 description")).toBeVisible({ timeout: EXPECT_TIMEOUT });
  });

  test("should archive a task", async ({ userAPage: page }) => {
    await page.goto(boardUrl);
    await expect(page.getByText("[E2E] Task 2")).toBeVisible({ timeout: EXPECT_TIMEOUT });
    await page.getByText("[E2E] Task 2").click();

    // Wait for dialog to open, then archive
    await expect(page.getByRole("button", { name: "Archive" })).toBeVisible({ timeout: EXPECT_TIMEOUT });
    await page.getByRole("button", { name: "Archive" }).click();

    // Wait for the dialog to close before checking the board
    await expect(page.getByLabel("Task Details")).not.toBeVisible({ timeout: EXPECT_TIMEOUT });

    // Task should no longer be visible on the board
    await expect(page.getByText("[E2E] Task 2")).not.toBeVisible({ timeout: EXPECT_TIMEOUT });
  });

  // TODO: delete task test needs investigation — the "Are you sure?" confirmation
  // button selector is unreliable in CI
});
