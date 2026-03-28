import { test, expect } from "../fixtures/auth";
import { EXPECT_TIMEOUT } from "../fixtures/constants";

test.describe("Logout", () => {
  test("should log out and redirect to landing page", async ({ userAPage: page }) => {
    await page.goto("/dashboard");
    await expect(page.getByRole("main")).toBeVisible({ timeout: EXPECT_TIMEOUT });

    // Open user menu (avatar button in top-right)
    const avatar = page.locator("header").getByRole("button").last();
    await avatar.click();

    // Click logout
    await page.getByRole("menuitem", { name: /log out|sign out/i }).click();

    // Should redirect to landing or login
    await page.waitForURL(/\/(login)?$/, { timeout: EXPECT_TIMEOUT });
  });
});
