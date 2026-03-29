import { test, expect } from "../fixtures/auth";
import { EXPECT_TIMEOUT } from "../fixtures/constants";

test.describe("Logout", () => {
  // Skip on mobile — the user menu is behind a hamburger menu with different structure
  test.skip(({ browserName }, testInfo) => testInfo.project.name === "Mobile Chrome", "Mobile menu has different structure");

  test("should log out and redirect to landing page", async ({ userAPage: page }) => {
    await page.goto("/dashboard");
    await page.waitForLoadState("domcontentloaded");
    await page.waitForTimeout(2000);

    // Open user menu dropdown — the avatar/profile button in the header
    const userMenu = page.locator("header button").last();
    await userMenu.click();

    // Click sign out
    await page.getByText(/sign out|log out/i).first().click();

    // Should redirect to landing or login
    await page.waitForURL(/\/(login)?$/, { timeout: EXPECT_TIMEOUT });
  });
});
