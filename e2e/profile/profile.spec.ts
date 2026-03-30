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

  test("should load profile page without errors", async ({ userAPage: page }) => {
    await page.goto(`/profile/${userAId}`);
    await page.waitForLoadState("domcontentloaded");
    // Profile page should have loaded (check URL stayed)
    await expect(page).toHaveURL(new RegExp(`/profile/${userAId}`));
  });
});
