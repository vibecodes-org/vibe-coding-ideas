import { test, expect } from "../fixtures/auth";
import { EXPECT_TIMEOUT } from "../fixtures/constants";

test.describe("Password Reset", () => {
  test("should display forgot password form", async ({ anonPage: page }) => {
    await page.goto("/forgot-password");
    await expect(page.getByLabel("Email")).toBeVisible({ timeout: EXPECT_TIMEOUT });
    await expect(page.getByRole("button", { name: "Send reset link" })).toBeVisible();
  });

  // Note: form submission test skipped — Turnstile CAPTCHA blocks headless browsers

  test("should have link back to login", async ({ anonPage: page }) => {
    await page.goto("/forgot-password");
    await expect(page.getByRole("link", { name: /login/i })).toBeVisible({ timeout: EXPECT_TIMEOUT });
  });
});
