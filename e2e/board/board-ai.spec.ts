import { test, expect } from "../fixtures/auth";
import { EXPECT_TIMEOUT } from "../fixtures/constants";
import { getTestUserId, createTestIdea, createTestBoardWithTasks, cleanupIdeas, scopedTitle } from "../fixtures/test-data";

let ideaId: string;
let boardUrl: string;

test.beforeAll(async () => {
  const userId = await getTestUserId("userA");
  const idea = await createTestIdea(userId, {
    title: scopedTitle("Board AI Test"),
    description: "[E2E] An idea for testing AI board generation.",
  });
  ideaId = idea.id;
  boardUrl = `/ideas/${ideaId}/board`;
  await createTestBoardWithTasks(ideaId, 1);
});

test.afterAll(async () => {
  await cleanupIdeas([ideaId]);
});

test.describe("Board AI Generation", () => {
  test("should show AI Generate button on board toolbar", async ({ userAPage: page }, testInfo) => {
    await page.goto(boardUrl);
    await expect(page.locator("[data-testid^='column-']").first()).toBeVisible({ timeout: EXPECT_TIMEOUT });

    if (testInfo.project.name === "Mobile Chrome") {
      // On mobile, the button text is hidden — find by the Sparkles icon inside the toolbar
      const toolbar = page.getByRole("main");
      await expect(toolbar.locator("button", { has: page.locator("svg.lucide-sparkles") })).toBeVisible();
    } else {
      await expect(page.getByRole("button", { name: /AI Generate/i })).toBeVisible();
    }
  });

  test("should show Import button on board toolbar", async ({ userAPage: page }) => {
    await page.goto(boardUrl);
    await expect(page.locator("[data-testid^='column-']").first()).toBeVisible({ timeout: EXPECT_TIMEOUT });
    await expect(page.getByTestId("import-button")).toBeVisible();
  });
});
