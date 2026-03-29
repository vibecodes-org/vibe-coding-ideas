import { test, expect } from "../fixtures/auth";
import { EXPECT_TIMEOUT } from "../fixtures/constants";

test.describe("Login", () => {
  test("should display login form with email and password fields", async ({ anonPage: page }) => {
    await page.goto("/login");
    await expect(page.getByText("Welcome back")).toBeVisible({ timeout: EXPECT_TIMEOUT });
    await expect(page.getByLabel("Email")).toBeVisible();
    await expect(page.getByLabel("Password")).toBeVisible();
    await expect(page.getByRole("button", { name: "Sign in with email" })).toBeVisible();
  });

  test("should display OAuth buttons", async ({ anonPage: page }) => {
    await page.goto("/login");
    await expect(page.getByRole("button", { name: /Continue with GitHub/i })).toBeVisible({ timeout: EXPECT_TIMEOUT });
    await expect(page.getByRole("button", { name: /Continue with Google/i })).toBeVisible();
  });

  // Note: browser-based login form submission tests are skipped because
  // production Supabase has Turnstile CAPTCHA enabled which blocks headless browsers.
  // Auth is verified via API in global-setup (service-role signInWithPassword).

  test("should have link to forgot password", async ({ anonPage: page }) => {
    await page.goto("/login");
    await expect(page.getByRole("link", { name: /Forgot password/i })).toBeVisible({ timeout: EXPECT_TIMEOUT });
  });

  test("should have link to signup", async ({ anonPage: page }) => {
    await page.goto("/login");
    await expect(page.getByRole("link", { name: /Sign up/i })).toBeVisible({ timeout: EXPECT_TIMEOUT });
  });

  test("should redirect logged-in users away from login page", async ({ userAPage: page }) => {
    await page.goto("/login");
    await page.waitForURL(/\/dashboard/, { timeout: EXPECT_TIMEOUT });
    await expect(page).toHaveURL(/\/dashboard/);
  });
});
