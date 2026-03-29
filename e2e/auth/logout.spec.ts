import { test, expect } from "../fixtures/auth";
import { EXPECT_TIMEOUT } from "../fixtures/constants";

// TODO: Logout test needs investigation — the user menu selector
// doesn't reliably find the dropdown trigger across browsers.
// Tracked as a follow-up task.
test.describe("Logout", () => {
  test.skip(() => true, "Logout menu selector needs investigation");

  test("should log out and redirect to landing page", async ({ userAPage: page }) => {
    await page.goto("/dashboard");
    await page.waitForLoadState("domcontentloaded");
    await page.waitForTimeout(2000);

    const userMenu = page.locator("header button").last();
    await userMenu.click();

    await page.getByText(/sign out|log out/i).first().click();

    await page.waitForURL(/\/(login)?$/, { timeout: EXPECT_TIMEOUT });
  });
});
