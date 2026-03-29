import { test, expect } from "../fixtures/auth";
import { EXPECT_TIMEOUT } from "../fixtures/constants";
import { getTestUserId, createTestIdea, createTestBoardWithTasks, cleanupIdeas, scopedTitle } from "../fixtures/test-data";

let ideaId: string;
let boardUrl: string;

test.beforeAll(async () => {
  const userId = await getTestUserId("userA");
  const idea = await createTestIdea(userId, { title: scopedTitle("Board Labels") });
  ideaId = idea.id;
  boardUrl = `/ideas/${ideaId}/board`;
  await createTestBoardWithTasks(ideaId, 2);
});

test.afterAll(async () => {
  await cleanupIdeas([ideaId]);
});

test.describe("Board Labels", () => {
  test("should create a label from the toolbar", async ({ userAPage: page }) => {
    await page.goto(boardUrl);
    await expect(page.locator("[data-testid^='task-card-']").first()).toBeVisible({ timeout: EXPECT_TIMEOUT });

    // Open the Labels filter popover
    await page.getByRole("button", { name: "Labels" }).click();

    // There should be no labels yet — look for "Create a label" or empty state
    await page.getByRole("button", { name: /Create a label/i }).click();

    // Fill in label name and create
    await page.getByPlaceholder("Label name").fill("E2E Label");
    // Click a color swatch (first one)
    await page.locator("[data-slot='popover-content'] button[class*='rounded-full']").first().click();
    // Click create/confirm button
    await page.locator("[data-slot='popover-content']").getByRole("button").filter({ has: page.locator("svg") }).first().click();

    await page.waitForTimeout(1000);
    // Label should now exist
    await expect(page.getByText("E2E Label")).toBeVisible({ timeout: EXPECT_TIMEOUT });
  });

  test("should add a label to a task", async ({ userAPage: page }) => {
    await page.goto(boardUrl);
    await expect(page.getByText("[E2E] Task 1")).toBeVisible({ timeout: EXPECT_TIMEOUT });

    // Open task detail
    await page.getByText("[E2E] Task 1").click();
    await expect(page.getByRole("tab", { name: "Details" })).toBeVisible({ timeout: EXPECT_TIMEOUT });

    // Click Edit labels button (Tag icon)
    await page.getByRole("button", { name: "Edit" }).first().click();

    // Check the E2E Label checkbox
    const labelCheckbox = page.getByText("E2E Label").locator("..");
    await labelCheckbox.locator("button, input, [role='checkbox']").first().click();

    // Close popover
    await page.keyboard.press("Escape");
    await page.waitForTimeout(500);

    // Label should be visible on the task
    await expect(page.getByText("E2E Label")).toBeVisible({ timeout: EXPECT_TIMEOUT });
  });

  test("should filter tasks by label", async ({ userAPage: page }) => {
    await page.goto(boardUrl);
    await expect(page.locator("[data-testid^='task-card-']").first()).toBeVisible({ timeout: EXPECT_TIMEOUT });

    // Both tasks should be visible initially
    await expect(page.getByText("[E2E] Task 1")).toBeVisible();
    await expect(page.getByText("[E2E] Task 2")).toBeVisible();

    // Open Labels filter
    await page.getByRole("button", { name: "Labels" }).click();

    // Select E2E Label
    const labelRow = page.getByText("E2E Label").locator("..").locator("[role='checkbox'], input, button").first();
    await labelRow.click();

    // Close filter
    await page.keyboard.press("Escape");
    await page.waitForTimeout(500);

    // Only Task 1 should be visible (it has the label)
    await expect(page.getByText("[E2E] Task 1")).toBeVisible({ timeout: EXPECT_TIMEOUT });
    // Task 2 should be filtered out
    await expect(page.getByText("[E2E] Task 2")).not.toBeVisible();
  });
});
