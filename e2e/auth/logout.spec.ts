import { test, expect } from "../fixtures/auth";
import { EXPECT_TIMEOUT } from "../fixtures/constants";

test.describe("Logout", () => {
  // Use userBPage to avoid invalidating userA's session (used by other tests)
  test("should log out and redirect to landing page", async ({ userBPage: page }, testInfo) => {
    // Only run on Desktop Chrome — logout destroys the session, and since
    // Desktop runs before Mobile, Mobile Chrome tests would fail
    if (testInfo.project.name === "Mobile Chrome") {
      test.skip();
      return;
    }

    await page.goto("/dashboard");
    await page.waitForLoadState("domcontentloaded");
    await page.waitForTimeout(2000);

    // Click avatar dropdown trigger, then Sign Out menu item
    await page.getByTestId("user-menu-trigger").click();
    await page.waitForTimeout(300);
    await page.getByRole("menuitem", { name: /Sign Out/i }).click();

    // Should redirect to landing or login
    await page.waitForURL(/\/(login)?$/, { timeout: EXPECT_TIMEOUT });
  });
});
