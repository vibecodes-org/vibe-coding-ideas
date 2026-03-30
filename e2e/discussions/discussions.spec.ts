import { test, expect } from "../fixtures/auth";
import { EXPECT_TIMEOUT } from "../fixtures/constants";
import { getTestUserId, createTestIdea, createTestDiscussion, cleanupIdeas, scopedTitle } from "../fixtures/test-data";

let ideaId: string;
let discussionsUrl: string;

test.beforeAll(async () => {
  const userId = await getTestUserId("userA");
  const idea = await createTestIdea(userId, { title: scopedTitle("Discussions Test") });
  ideaId = idea.id;
  discussionsUrl = `/ideas/${ideaId}/discussions`;

  // Create a test discussion
  await createTestDiscussion(ideaId, userId, {
    title: scopedTitle("Test Discussion"),
    body: "[E2E] A discussion for testing.",
  });
});

test.afterAll(async () => {
  await cleanupIdeas([ideaId]);
});

test.describe("Discussions", () => {
  test("should display Discussions page", async ({ userAPage: page }) => {
    await page.goto(discussionsUrl);
    await expect(page.getByRole("heading", { name: "Discussions" })).toBeVisible({ timeout: EXPECT_TIMEOUT });
  });

  test("should show subtitle text", async ({ userAPage: page }) => {
    await page.goto(discussionsUrl);
    await expect(page.getByText(/Plan, debate, and refine/i)).toBeVisible({ timeout: EXPECT_TIMEOUT });
  });

  test("should show New Discussion button for team members", async ({ userAPage: page }) => {
    await page.goto(discussionsUrl);
    await expect(page.getByRole("heading", { name: "Discussions" })).toBeVisible({ timeout: EXPECT_TIMEOUT });
    await expect(page.getByRole("link", { name: /New Discussion/i })).toBeVisible();
  });

  test("should display existing discussions", async ({ userAPage: page }) => {
    await page.goto(discussionsUrl);
    await expect(page.getByText(/Test Discussion/)).toBeVisible({ timeout: EXPECT_TIMEOUT });
  });
});
