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
    await expect(page.locator("[data-testid^='column-']").first()).toBeVisible({ timeout: EXPECT_TIMEOUT });
    // The Workflows tab is a tab trigger, not a link
    await expect(page.getByRole("tab", { name: "Workflows" })).toBeVisible();
  });

  test("should navigate to Workflows tab and show templates section", async ({ userAPage: page }) => {
    await page.goto(boardUrl);
    await expect(page.locator("[data-testid^='column-']").first()).toBeVisible({ timeout: EXPECT_TIMEOUT });

    // Click the Workflows tab
    await page.getByRole("tab", { name: "Workflows" }).click();

    // Should show TEMPLATES header
    await expect(page.getByText("TEMPLATES")).toBeVisible({ timeout: EXPECT_TIMEOUT });
  });

  test("should display Agents tab on board", async ({ userAPage: page }) => {
    await page.goto(boardUrl);
    await expect(page.locator("[data-testid^='column-']").first()).toBeVisible({ timeout: EXPECT_TIMEOUT });
    await expect(page.getByRole("tab", { name: "Agents" })).toBeVisible();
  });
});
