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
    await expect(page.getByText("Test User A")).toBeVisible({ timeout: EXPECT_TIMEOUT });
  });

  test("should show Manage agents link on own profile", async ({ userAPage: page }) => {
    await page.goto(`/profile/${userAId}`);
    await expect(page.getByText("Test User A")).toBeVisible({ timeout: EXPECT_TIMEOUT });
    await expect(page.getByRole("link", { name: /Manage agents/i })).toBeVisible();
  });

  test("should show profile tabs", async ({ userAPage: page }) => {
    await page.goto(`/profile/${userAId}`);
    await expect(page.getByText("Test User A")).toBeVisible({ timeout: EXPECT_TIMEOUT });
    // Profile should have tabs for ideas/collaborations/comments
    await expect(page.getByRole("tab").first()).toBeVisible();
  });
});
