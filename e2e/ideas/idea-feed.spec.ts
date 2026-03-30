import { test, expect } from "../fixtures/auth";
import { EXPECT_TIMEOUT } from "../fixtures/constants";
import { getTestUserId, createTestIdea, cleanupIdeas, scopedTitle } from "../fixtures/test-data";

const ideaIds: string[] = [];

test.beforeAll(async () => {
  const userId = await getTestUserId("userA");
  for (let i = 1; i <= 3; i++) {
    const idea = await createTestIdea(userId, {
      title: scopedTitle(`Feed Test ${i}`),
      description: `[E2E] Feed test idea ${i}`,
    });
    ideaIds.push(idea.id);
  }
});

test.afterAll(async () => {
  await cleanupIdeas(ideaIds);
});

test.describe("Idea Feed", () => {
  test("should display Idea Feed page", async ({ userAPage: page }) => {
    await page.goto("/ideas");
    await expect(page.getByText("Idea Feed")).toBeVisible({ timeout: EXPECT_TIMEOUT });
  });

  test("should show view tabs", async ({ userAPage: page }) => {
    await page.goto("/ideas");
    await expect(page.getByText("All Ideas")).toBeVisible({ timeout: EXPECT_TIMEOUT });
    await expect(page.getByText("My Ideas")).toBeVisible();
  });

  test("should have search input", async ({ userAPage: page }) => {
    await page.goto("/ideas");
    await expect(page.getByPlaceholder("Search ideas...")).toBeVisible({ timeout: EXPECT_TIMEOUT });
  });

  test("should display idea cards", async ({ userAPage: page }) => {
    await page.goto("/ideas");
    await expect(page.getByText("Idea Feed")).toBeVisible({ timeout: EXPECT_TIMEOUT });
    // There should be at least some idea cards on the page
    await expect(page.locator("[data-testid^='idea-card-']").first()).toBeVisible({ timeout: EXPECT_TIMEOUT });
  });
});
