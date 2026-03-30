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

  test("should show All Ideas, My Ideas, and Collaborating tabs", async ({ userAPage: page }) => {
    await page.goto("/ideas");
    await expect(page.getByText("All Ideas")).toBeVisible({ timeout: EXPECT_TIMEOUT });
    await expect(page.getByText("My Ideas")).toBeVisible();
    await expect(page.getByText("Collaborating")).toBeVisible();
  });

  test("should have search input", async ({ userAPage: page }) => {
    await page.goto("/ideas");
    await expect(page.getByPlaceholder("Search ideas...")).toBeVisible({ timeout: EXPECT_TIMEOUT });
  });

  test("should have sort and status filters", async ({ userAPage: page }) => {
    await page.goto("/ideas");
    await expect(page.getByText("Idea Feed")).toBeVisible({ timeout: EXPECT_TIMEOUT });
    // Sort dropdown and status filter should exist
    await expect(page.getByText(/Newest|All statuses/i).first()).toBeVisible();
  });

  test("should have New Idea button", async ({ userAPage: page }) => {
    await page.goto("/ideas");
    await expect(page.getByRole("link", { name: /New Idea/i })).toBeVisible({ timeout: EXPECT_TIMEOUT });
  });
});
