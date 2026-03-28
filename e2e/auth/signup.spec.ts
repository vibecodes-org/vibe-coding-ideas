import { test, expect } from "../fixtures/auth";
import { EXPECT_TIMEOUT } from "../fixtures/constants";

test.describe("Signup", () => {
  test("should display signup form with email and password fields", async ({ anonPage: page }) => {
    await page.goto("/signup");
    await expect(page.getByText("Create your account")).toBeVisible({ timeout: EXPECT_TIMEOUT });
    await expect(page.getByLabel("Email")).toBeVisible();
    await expect(page.getByLabel("Password")).toBeVisible();
    await expect(page.getByRole("button", { name: "Create account" })).toBeVisible();
  });

  test("should display OAuth buttons", async ({ anonPage: page }) => {
    await page.goto("/signup");
    await expect(page.getByRole("button", { name: /Continue with GitHub/i })).toBeVisible({ timeout: EXPECT_TIMEOUT });
    await expect(page.getByRole("button", { name: /Continue with Google/i })).toBeVisible();
  });

  test("should show error for existing email", async ({ anonPage: page }) => {
    await page.goto("/signup");
    await page.getByLabel("Email").fill("test-user-a@vibecodes-test.local");
    await page.getByLabel("Password").fill("TestPassword123!");
    await page.getByRole("button", { name: "Create account" }).click();
    await expect(
      page.getByText(/already exists|already been registered/i)
    ).toBeVisible({ timeout: EXPECT_TIMEOUT });
  });

  test("should have link to login", async ({ anonPage: page }) => {
    await page.goto("/signup");
    await expect(page.getByRole("link", { name: /Log in/i })).toBeVisible({ timeout: EXPECT_TIMEOUT });
  });

  test("should redirect logged-in users away from signup page", async ({ userAPage: page }) => {
    await page.goto("/signup");
    await page.waitForURL(/\/dashboard/, { timeout: EXPECT_TIMEOUT });
    await expect(page).toHaveURL(/\/dashboard/);
  });
});
