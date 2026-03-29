import { test, expect } from "../fixtures/auth";
import { EXPECT_TIMEOUT } from "../fixtures/constants";

test.describe("Logout", () => {
  // Use userBPage to avoid invalidating userA's session (used by other tests)
  test("should log out and redirect to landing page", async ({ userBPage: page }, testInfo) => {
    await page.goto("/dashboard");
    await page.waitForLoadState("domcontentloaded");
    await page.waitForTimeout(2000);

    const isMobile = testInfo.project.name === "Mobile Chrome";

    if (isMobile) {
      // Mobile: open hamburger menu, then click Sign Out button
      await page.getByLabel("Open navigation menu").click();
      await page.waitForTimeout(500);
      await page.getByRole("button", { name: /Sign Out/i }).click();
    } else {
      // Desktop: click the avatar/user menu trigger, then Sign Out
      // The trigger is a button containing an Avatar (img or fallback text)
      const trigger = page.locator("header").locator("button", { has: page.locator("span[class*='avatar'], img[alt]") }).last();
      await trigger.click();
      await page.waitForTimeout(300);
      await page.getByRole("menuitem", { name: /Sign Out/i }).click();
    }

    // Should redirect to landing or login
    await page.waitForURL(/\/(login)?$/, { timeout: EXPECT_TIMEOUT });
  });
});
