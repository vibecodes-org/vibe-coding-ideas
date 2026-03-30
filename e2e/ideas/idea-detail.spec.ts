import { test, expect } from "../fixtures/auth";
import { EXPECT_TIMEOUT } from "../fixtures/constants";
import { getTestUserId, createTestIdea, cleanupIdeas, scopedTitle } from "../fixtures/test-data";

let ideaId: string;
let ideaUrl: string;

test.beforeAll(async () => {
  const userId = await getTestUserId("userA");
  const idea = await createTestIdea(userId, {
    title: scopedTitle("Detail Test"),
    description: "[E2E] A detailed description for testing the idea detail page.",
  });
  ideaId = idea.id;
  ideaUrl = `/ideas/${ideaId}`;
});

test.afterAll(async () => {
  await cleanupIdeas([ideaId]);
});

test.describe("Idea Detail", () => {
  test("should display idea title and description", async ({ userAPage: page }) => {
    await page.goto(ideaUrl);
    await expect(page.getByText(/Detail Test/)).toBeVisible({ timeout: EXPECT_TIMEOUT });
    await expect(page.getByText("A detailed description for testing")).toBeVisible();
  });

  test("should display vote button", async ({ userAPage: page }) => {
    await page.goto(ideaUrl);
    await expect(page.getByTestId("vote-button")).toBeVisible({ timeout: EXPECT_TIMEOUT });
  });

  test("should toggle vote on click", async ({ userAPage: page }) => {
    await page.goto(ideaUrl);
    const voteButton = page.getByTestId("vote-button");
    await expect(voteButton).toBeVisible({ timeout: EXPECT_TIMEOUT });

    // Get initial count
    const initialText = await voteButton.textContent();
    const initialCount = parseInt(initialText?.match(/\d+/)?.[0] ?? "0");

    // Click to vote
    await voteButton.click();
    await page.waitForTimeout(1000);

    // Count should change
    const afterText = await voteButton.textContent();
    const afterCount = parseInt(afterText?.match(/\d+/)?.[0] ?? "0");
    expect(afterCount).not.toBe(initialCount);
  });

  test("should display comment section", async ({ userAPage: page }) => {
    await page.goto(ideaUrl);
    await expect(page.getByText(/Comments/i)).toBeVisible({ timeout: EXPECT_TIMEOUT });
    await expect(page.getByPlaceholder(/Add a comment/i)).toBeVisible();
  });

  test("should post a comment", async ({ userAPage: page }) => {
    await page.goto(ideaUrl);
    await expect(page.getByPlaceholder(/Add a comment/i)).toBeVisible({ timeout: EXPECT_TIMEOUT });

    await page.getByPlaceholder(/Add a comment/i).fill("[E2E] Test comment from E2E tests");
    await page.getByRole("button", { name: /Post/i }).click();

    await expect(page.getByText("[E2E] Test comment from E2E tests")).toBeVisible({ timeout: EXPECT_TIMEOUT });
  });

  test("should show board link for idea author", async ({ userAPage: page }) => {
    await page.goto(ideaUrl);
    await expect(page.getByRole("link", { name: /Board/i })).toBeVisible({ timeout: EXPECT_TIMEOUT });
  });
});
