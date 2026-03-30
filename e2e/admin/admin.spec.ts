import { test, expect } from "../fixtures/auth";
import { EXPECT_TIMEOUT } from "../fixtures/constants";

test.describe("Admin", () => {
  test("should redirect non-admin to dashboard", async ({ userAPage: page }) => {
    await page.goto("/admin");
    await page.waitForURL(/\/dashboard/, { timeout: EXPECT_TIMEOUT });
    await expect(page).toHaveURL(/\/dashboard/);
  });

  test("should allow admin access", async ({ adminPage: page }) => {
    await page.goto("/admin");
    await page.waitForLoadState("domcontentloaded");
    await expect(page).toHaveURL(/\/admin/);
    await expect(page.getByRole("heading", { name: "Admin" })).toBeVisible({ timeout: EXPECT_TIMEOUT });
  });

  test("should show admin tabs", async ({ adminPage: page }) => {
    await page.goto("/admin");
    await expect(page.getByRole("heading", { name: "Admin" })).toBeVisible({ timeout: EXPECT_TIMEOUT });
    await expect(page.getByText("AI Usage")).toBeVisible();
    await expect(page.getByText("Feedback")).toBeVisible();
    await expect(page.getByText("Agents")).toBeVisible();
  });
});
