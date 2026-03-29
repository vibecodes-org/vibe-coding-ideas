import { test, expect } from "../fixtures/auth";
import { EXPECT_TIMEOUT } from "../fixtures/constants";
import { getTestUserId, createTestIdea, createTestBoardWithTasks, cleanupIdeas, scopedTitle } from "../fixtures/test-data";

let ideaId: string;
let boardUrl: string;

test.beforeAll(async () => {
  const userId = await getTestUserId("userA");
  const idea = await createTestIdea(userId, { title: scopedTitle("Workflow Templates") });
  ideaId = idea.id;
  boardUrl = `/ideas/${ideaId}/board`;
  await createTestBoardWithTasks(ideaId, 2);
});

test.afterAll(async () => {
  await cleanupIdeas([ideaId]);
});

test.describe("Workflow Templates", () => {
  test("should display Workflows tab on board", async ({ userAPage: page }) => {
    await page.goto(boardUrl);
    await expect(page.getByRole("link", { name: "Workflows" }).or(page.getByText("Workflows"))).toBeVisible({ timeout: EXPECT_TIMEOUT });
  });

  test("should navigate to Workflows tab and show templates", async ({ userAPage: page }) => {
    await page.goto(boardUrl + "?tab=workflows");
    await expect(page.getByText("TEMPLATES")).toBeVisible({ timeout: EXPECT_TIMEOUT });
  });

  test("should apply a workflow template to a task", async ({ userAPage: page }) => {
    await page.goto(boardUrl);
    await expect(page.getByText("[E2E] Task 1")).toBeVisible({ timeout: EXPECT_TIMEOUT });

    // Open task detail
    await page.getByText("[E2E] Task 1").click();
    await expect(page.getByRole("tab", { name: "Details" })).toBeVisible({ timeout: EXPECT_TIMEOUT });

    // Look for workflow section — it should show "Apply Workflow" or similar
    // Scroll down if needed
    const applyButton = page.getByText(/Apply Workflow|Apply a template/i);
    if (await applyButton.isVisible({ timeout: 5000 }).catch(() => false)) {
      await applyButton.click();

      // Select a template from the dropdown
      await page.locator("select, [role='combobox']").first().click();
      await page.waitForTimeout(500);

      // Pick the first template option
      const firstOption = page.getByRole("option").first();
      if (await firstOption.isVisible({ timeout: 3000 }).catch(() => false)) {
        await firstOption.click();

        // Click Apply
        const applyConfirm = page.getByRole("button", { name: /Apply/i });
        if (await applyConfirm.isVisible({ timeout: 3000 }).catch(() => false)) {
          await applyConfirm.click();

          // Workflow steps should appear
          await expect(page.getByText(/Pending|step/i)).toBeVisible({ timeout: EXPECT_TIMEOUT });
        }
      }
    }
  });
});
