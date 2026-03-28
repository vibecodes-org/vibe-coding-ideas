import { test, expect } from "../fixtures/auth";
import { EXPECT_TIMEOUT } from "../fixtures/constants";

test.describe("Logout", () => {
  test("should log out and redirect to landing page", async ({ userAPage: page }) => {
    await page.goto("/dashboard");
    await page.waitForLoadState("domcontentloaded");

    // Open user menu — look for the dropdown trigger in the header
    const userMenuButton = page.locator("header").getByRole("button").filter({ has: page.locator("img, span") }).last();
    await userMenuButton.click();

    // Click logout/sign out
    const logoutItem = page.getByRole("menuitem", { name: /log out|sign out/i });
    // Fall back to link if no menuitem
    const logoutLink = page.getByRole("link", { name: /log out|sign out/i });

    if (await logoutItem.isVisible({ timeout: 3000 }).catch(() => false)) {
      await logoutItem.click();
    } else {
      await logoutLink.click();
    }

    // Should redirect to landing or login
    await page.waitForURL(/\/(login)?$/, { timeout: EXPECT_TIMEOUT });
  });
});
