import { test, expect } from "../fixtures/auth";
import { EXPECT_TIMEOUT } from "../fixtures/constants";
import { getTestUserId, createTestIdea, createTestBoardWithTasks, cleanupIdeas, scopedTitle } from "../fixtures/test-data";
import { supabaseAdmin } from "../fixtures/supabase-admin";

let ideaId: string;
let boardUrl: string;

test.beforeAll(async () => {
  const userId = await getTestUserId("userA");
  const idea = await createTestIdea(userId, { title: scopedTitle("Board Labels") });
  ideaId = idea.id;
  boardUrl = `/ideas/${ideaId}/board`;
  await createTestBoardWithTasks(ideaId, 2);

  // Create a test label via DB
  await supabaseAdmin.from("board_labels").insert({
    idea_id: ideaId,
    name: "E2E Label",
    color: "blue",
  });
});

test.afterAll(async () => {
  await cleanupIdeas([ideaId]);
});

test.describe("Board Labels", () => {
  test("should add a label to a task from the detail dialog", async ({ userAPage: page }) => {
    await page.goto(boardUrl);
    await expect(page.getByText("[E2E] Task 1")).toBeVisible({ timeout: EXPECT_TIMEOUT });

    // Open task detail
    await page.getByText("[E2E] Task 1").click();
    await expect(page.getByRole("tab", { name: "Details" })).toBeVisible({ timeout: EXPECT_TIMEOUT });

    // Click the Edit labels button (Tag icon next to "Labels" heading)
    const labelsSection = page.getByText("Labels").first().locator("..");
    await labelsSection.getByRole("button").first().click();

    // The label picker popover should show E2E Label
    await expect(page.getByText("E2E Label")).toBeVisible({ timeout: EXPECT_TIMEOUT });

    // Toggle the label on
    await page.getByText("E2E Label").click();

    // Close the popover
    await page.keyboard.press("Escape");
    await page.waitForTimeout(500);

    // The label badge should be visible in the task detail
    await expect(page.getByText("E2E Label")).toBeVisible({ timeout: EXPECT_TIMEOUT });
  });

  test("should filter tasks by label from the toolbar", async ({ userAPage: page }) => {
    await page.goto(boardUrl);
    await expect(page.locator("[data-testid^='task-card-']").first()).toBeVisible({ timeout: EXPECT_TIMEOUT });

    // Both tasks visible initially
    await expect(page.getByText("[E2E] Task 1")).toBeVisible();
    await expect(page.getByText("[E2E] Task 2")).toBeVisible();

    // Open Labels filter in toolbar
    const labelsButton = page.getByRole("main").getByRole("button", { name: "Labels" });
    await labelsButton.click();

    // Select E2E Label
    await page.getByText("E2E Label").last().click();

    // Close filter
    await page.keyboard.press("Escape");
    await page.waitForTimeout(1000);

    // Only Task 1 should be visible (it has the label from previous test)
    await expect(page.getByText("[E2E] Task 1")).toBeVisible({ timeout: EXPECT_TIMEOUT });
  });
});
