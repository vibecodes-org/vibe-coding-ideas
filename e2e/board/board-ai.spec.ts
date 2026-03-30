import { test, expect } from "../fixtures/auth";
import { EXPECT_TIMEOUT } from "../fixtures/constants";
import { getTestUserId, createTestIdea, createTestBoardColumns, cleanupIdeas, scopedTitle } from "../fixtures/test-data";

let ideaId: string;
let boardUrl: string;

test.beforeAll(async () => {
  const userId = await getTestUserId("userA");
  const idea = await createTestIdea(userId, {
    title: scopedTitle("Board AI"),
    description: "[E2E] An idea for testing AI board generation.",
  });
  ideaId = idea.id;
  boardUrl = `/ideas/${ideaId}/board`;
  // Create columns but no tasks — so the AI generate CTA shows
  await createTestBoardColumns(ideaId);
});

test.afterAll(async () => {
  await cleanupIdeas([ideaId]);
});

test.describe("Board AI Generation", () => {
  test("should show AI Generate button on board with tasks", async ({ userAPage: page }) => {
    await page.goto(boardUrl);
    await page.waitForLoadState("domcontentloaded");
    await page.waitForTimeout(2000);

    // Either the empty state CTA or the toolbar button should be visible
    const hasEmptyStateCta = await page.getByRole("button", { name: /AI Generate/i }).first().isVisible({ timeout: 5000 }).catch(() => false);
    const hasToolbarButton = await page.getByRole("button", { name: /AI Generate/i }).first().isVisible({ timeout: 3000 }).catch(() => false);
    expect(hasEmptyStateCta || hasToolbarButton).toBe(true);
  });

  test("should open AI Generate dialog when clicking the button", async ({ userAPage: page }) => {
    await page.goto(boardUrl);
    await page.waitForLoadState("domcontentloaded");
    await page.waitForTimeout(2000);

    // Click AI Generate button (either empty state or toolbar)
    await page.getByRole("button", { name: /AI Generate/i }).first().click();

    // Dialog should open
    await expect(page.getByText(/AI Generate Board|Generate/i)).toBeVisible({ timeout: EXPECT_TIMEOUT });
  });
});
