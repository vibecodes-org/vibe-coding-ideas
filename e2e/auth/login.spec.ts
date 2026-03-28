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

  test("should show error for invalid credentials", async ({ anonPage: page }) => {
    await page.goto("/login");
    await page.getByLabel("Email").fill("nonexistent@test.com");
    await page.getByLabel("Password").fill("wrongpassword");
    await page.getByRole("button", { name: "Sign in with email" }).click();
    await expect(page.getByText("Incorrect email or password")).toBeVisible({ timeout: EXPECT_TIMEOUT });
  });

  test("should redirect to dashboard on successful login", async ({ anonPage: page }) => {
    await page.goto("/login");
    await page.getByLabel("Email").fill("test-user-a@vibecodes-test.local");
    await page.getByLabel("Password").fill("TestPassword123!");
    await page.getByRole("button", { name: "Sign in with email" }).click();
    await page.waitForURL("**/dashboard", { timeout: EXPECT_TIMEOUT });
    await expect(page).toHaveURL(/\/dashboard/);
  });

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
    await page.waitForURL("**/dashboard", { timeout: EXPECT_TIMEOUT });
    await expect(page).toHaveURL(/\/dashboard/);
  });
});
