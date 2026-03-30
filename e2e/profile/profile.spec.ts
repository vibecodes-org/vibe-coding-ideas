import { test, expect } from "../fixtures/auth";
import { EXPECT_TIMEOUT } from "../fixtures/constants";
import { getTestUserId } from "../fixtures/test-data";

let userAId: string;

test.beforeAll(async () => {
  userAId = await getTestUserId("userA");
});

test.describe("Profile", () => {
  test("should display user profile page", async ({ userAPage: page }) => {
    await page.goto(`/profile/${userAId}`);
    await page.waitForLoadState("domcontentloaded");
    // Profile page should load and show the user's name somewhere
    await expect(page.getByText("Test User A").first()).toBeVisible({ timeout: EXPECT_TIMEOUT });
  });

  test("should show Manage agents link on own profile", async ({ userAPage: page }) => {
    await page.goto(`/profile/${userAId}`);
    await expect(page.getByRole("link", { name: /Manage agents/i })).toBeVisible({ timeout: EXPECT_TIMEOUT });
  });

  test("should show profile content", async ({ userAPage: page }) => {
    await page.goto(`/profile/${userAId}`);
    await page.waitForLoadState("domcontentloaded");
    // Profile should have some content loaded
    await expect(page.getByText(/ideas|collabs|Joined/i).first()).toBeVisible({ timeout: EXPECT_TIMEOUT });
  });
});
