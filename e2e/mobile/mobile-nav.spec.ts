import { test, expect } from "../fixtures/auth";
import { EXPECT_TIMEOUT } from "../fixtures/constants";

test.describe("Mobile Navigation", () => {
  // Only run on Mobile Chrome
  test.beforeEach(async ({}, testInfo) => {
    if (testInfo.project.name !== "Mobile Chrome") {
      test.skip();
    }
  });

  test("should show hamburger menu button", async ({ userAPage: page }) => {
    await page.goto("/dashboard");
    await page.waitForLoadState("domcontentloaded");
    await expect(page.getByLabel("Open navigation menu")).toBeVisible({ timeout: EXPECT_TIMEOUT });
  });

  test("should open mobile menu with navigation links", async ({ userAPage: page }) => {
    await page.goto("/dashboard");
    await page.waitForLoadState("domcontentloaded");

    await page.getByLabel("Open navigation menu").click();
    await page.waitForTimeout(500);

    await expect(page.getByRole("link", { name: "Dashboard" })).toBeVisible({ timeout: EXPECT_TIMEOUT });
    await expect(page.getByRole("link", { name: "Ideas" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Agents" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Guide" })).toBeVisible();
  });

  test("should navigate to Ideas from mobile menu", async ({ userAPage: page }) => {
    await page.goto("/dashboard");
    await page.waitForLoadState("domcontentloaded");

    await page.getByLabel("Open navigation menu").click();
    await page.waitForTimeout(500);
    await page.getByRole("link", { name: "Ideas" }).click();

    await page.waitForURL(/\/ideas/, { timeout: EXPECT_TIMEOUT });
  });

  test("should show Sign Out in mobile menu", async ({ userBPage: page }) => {
    await page.goto("/dashboard");
    await page.waitForLoadState("domcontentloaded");

    await page.getByLabel("Open navigation menu").click();
    await page.waitForTimeout(500);

    await expect(page.getByRole("button", { name: /Sign Out/i })).toBeVisible();
  });
});
