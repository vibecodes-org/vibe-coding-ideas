import { test, expect } from "../fixtures/auth";
import { EXPECT_TIMEOUT } from "../fixtures/constants";

test.describe("Members", () => {
  test("should display Members page", async ({ userAPage: page }) => {
    await page.goto("/members");
    await expect(page.getByRole("heading", { name: "Members" })).toBeVisible({ timeout: EXPECT_TIMEOUT });
  });

  test("should have search input", async ({ userAPage: page }) => {
    await page.goto("/members");
    await expect(page.getByPlaceholder("Search members...")).toBeVisible({ timeout: EXPECT_TIMEOUT });
  });

  test("should have sort dropdown", async ({ userAPage: page }) => {
    await page.goto("/members");
    await expect(page.getByLabel("Sort members")).toBeVisible({ timeout: EXPECT_TIMEOUT });
  });

  test("should display member cards", async ({ userAPage: page }) => {
    await page.goto("/members");
    await expect(page.getByRole("heading", { name: "Members" })).toBeVisible({ timeout: EXPECT_TIMEOUT });
    // Should show at least the current user
    await expect(page.getByText(/ideas.*collabs|Joined/i).first()).toBeVisible({ timeout: EXPECT_TIMEOUT });
  });

  test("should not show test users", async ({ userAPage: page }) => {
    await page.goto("/members");
    await expect(page.getByRole("heading", { name: "Members" })).toBeVisible({ timeout: EXPECT_TIMEOUT });
    // Test users should be filtered out
    await expect(page.getByText("test-user-a@vibecodes-test.local")).not.toBeVisible();
    await expect(page.getByText("test-fresh@vibecodes-test.local")).not.toBeVisible();
  });
});
