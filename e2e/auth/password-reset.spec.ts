import { test, expect } from "../fixtures/auth";
import { EXPECT_TIMEOUT } from "../fixtures/constants";

test.describe("Password Reset", () => {
  test("should display forgot password form", async ({ anonPage: page }) => {
    await page.goto("/forgot-password");
    await expect(page.getByLabel("Email")).toBeVisible({ timeout: EXPECT_TIMEOUT });
    await expect(page.getByRole("button", { name: "Send reset link" })).toBeVisible();
  });

  test("should show success message after requesting reset", async ({ anonPage: page }) => {
    await page.goto("/forgot-password");
    await page.getByLabel("Email").fill("test-user-a@vibecodes-test.local");
    await page.getByRole("button", { name: "Send reset link" }).click();
    await expect(page.getByText(/Check your email/i)).toBeVisible({ timeout: EXPECT_TIMEOUT });
  });

  test("should have link back to login", async ({ anonPage: page }) => {
    await page.goto("/forgot-password");
    await expect(page.getByRole("link", { name: /login/i })).toBeVisible({ timeout: EXPECT_TIMEOUT });
  });
});
