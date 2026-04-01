import { test, expect } from "../fixtures/auth";
import { EXPECT_TIMEOUT } from "../fixtures/constants";

test.describe("Dashboard", () => {
  test("should display Dashboard heading", async ({ userAPage: page }) => {
    await page.goto("/dashboard");
    await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible({ timeout: EXPECT_TIMEOUT });
  });

  test("should show welcome message or dashboard sections", async ({ userAPage: page }) => {
    await page.goto("/dashboard");
    await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible({ timeout: EXPECT_TIMEOUT });
    // Dashboard content varies (first-run vs standard), just verify it loaded
    await expect(page.getByText(/Welcome back|My Ideas|Setup Progress/i).first()).toBeVisible({ timeout: EXPECT_TIMEOUT });
  });

  test("should have link to create an idea", async ({ userAPage: page }) => {
    await page.goto("/dashboard");
    await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible({ timeout: EXPECT_TIMEOUT });
    await expect(page.getByRole("link", { name: /Create an idea|View all/i }).first()).toBeVisible({ timeout: EXPECT_TIMEOUT });
  });

  test("should have link to manage agents", async ({ userAPage: page }) => {
    await page.goto("/dashboard");
    await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible({ timeout: EXPECT_TIMEOUT });
    await expect(page.getByRole("link", { name: "Manage" })).toBeVisible();
  });
});
