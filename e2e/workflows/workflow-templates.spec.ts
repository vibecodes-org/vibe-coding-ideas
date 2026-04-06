import { test, expect } from "../fixtures/auth";
import { EXPECT_TIMEOUT } from "../fixtures/constants";
import { getTestUserId, createTestIdea, createTestBoardWithTasks, cleanupIdeas, scopedTitle } from "../fixtures/test-data";

let ideaId: string;
let boardUrl: string;

test.beforeAll(async () => {
  const userId = await getTestUserId("userA");
  const idea = await createTestIdea(userId, { title: scopedTitle("Workflows Test") });
  ideaId = idea.id;
  boardUrl = `/ideas/${ideaId}/board`;
  await createTestBoardWithTasks(ideaId, 1);
});

test.afterAll(async () => {
  await cleanupIdeas([ideaId]);
});

test.describe("Workflow Templates", () => {
  test("should display Board, Workflows and Agents tabs", async ({ userAPage: page }) => {
    await page.goto(boardUrl);
    await expect(page.locator("[data-testid^='column-']").first()).toBeVisible({ timeout: EXPECT_TIMEOUT });
    await expect(page.getByRole("tab", { name: "Board" })).toBeVisible();
    await expect(page.getByRole("tab", { name: "Workflows" })).toBeVisible();
    await expect(page.getByRole("tab", { name: "Agents" })).toBeVisible();
  });

  test("should switch to Workflows tab", async ({ userAPage: page }) => {
    await page.goto(boardUrl);
    await expect(page.locator("[data-testid^='column-']").first()).toBeVisible({ timeout: EXPECT_TIMEOUT });

    await page.getByRole("tab", { name: "Workflows" }).click();

    // Should show template-related content (either templates list or empty state)
    // Scope to main to avoid matching navbar/banner text
    const main = page.getByRole("main");
    await expect(
      main.getByText(/workflow|template|kit/i).first()
    ).toBeVisible({ timeout: EXPECT_TIMEOUT });
  });

  test("should display Agents tab on board", async ({ userAPage: page }) => {
    await page.goto(boardUrl);
    await expect(page.locator("[data-testid^='column-']").first()).toBeVisible({ timeout: EXPECT_TIMEOUT });
    await expect(page.getByRole("tab", { name: "Agents" })).toBeVisible();
  });
});
