import { test, expect } from "../fixtures/auth";
import { EXPECT_TIMEOUT } from "../fixtures/constants";

test.describe("Logout", () => {
  test("should log out and redirect to landing page", async ({ userAPage: page }, testInfo) => {
    await page.goto("/dashboard");
    await page.waitForLoadState("domcontentloaded");
    await page.waitForTimeout(2000);

    const isMobile = testInfo.project.name === "Mobile Chrome";

    if (isMobile) {
      // Mobile: open hamburger menu first
      await page.getByLabel("Open navigation menu").click();
      await page.getByRole("button", { name: /Sign Out/i }).click();
    } else {
      // Desktop: click avatar dropdown, then Sign Out menu item
      const avatarButton = page.locator("header button.rounded-full");
      await avatarButton.click();
      await page.getByRole("menuitem", { name: /Sign Out/i }).click();
    }

    // Should redirect to landing or login
    await page.waitForURL(/\/(login)?$/, { timeout: EXPECT_TIMEOUT });
  });
});
