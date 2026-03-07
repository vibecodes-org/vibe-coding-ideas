import { test, expect } from "../fixtures/auth";

test.describe("Logout", () => {
  // Use freshPage for sign-out tests to avoid revoking shared auth tokens
  // (userA/userB storage states are reused across all other specs)

  test("sign out via user menu redirects to landing or login", async ({ freshPage }) => {
    // Use /ideas instead of /dashboard to avoid the onboarding dialog
    // (fresh user has no onboarding_completed_at, which triggers an un-dismissable dialog on /dashboard)
    await freshPage.goto("/ideas");
    await expect(freshPage).toHaveURL(/\/ideas/, { timeout: 15_000 });

    // Open the user dropdown menu
    const avatarButton = freshPage
      .locator("nav")
      .locator("button")
      .filter({ has: freshPage.locator("span.relative, [data-slot='avatar']") })
      .first();
    await expect(avatarButton).toBeVisible({ timeout: 15_000 });
    await avatarButton.click();

    // Click "Sign Out"
    const signOutItem = freshPage.getByText("Sign Out");
    await expect(signOutItem).toBeVisible({ timeout: 5_000 });
    await signOutItem.click();

    // Should redirect to landing page or login
    await freshPage.waitForURL(/\/(login)?$/, { timeout: 15_000 });
    const url = new URL(freshPage.url());
    expect(url.pathname === "/" || url.pathname === "/login").toBe(true);
  });

  test("after sign out, navigating to /dashboard redirects to /login", async ({
    freshPage,
  }) => {
    await freshPage.goto("/ideas");
    await expect(freshPage).toHaveURL(/\/ideas/, { timeout: 15_000 });

    // Sign out
    const avatarButton = freshPage
      .locator("nav")
      .locator("button")
      .filter({ has: freshPage.locator("span.relative, [data-slot='avatar']") })
      .first();
    await expect(avatarButton).toBeVisible({ timeout: 15_000 });
    await avatarButton.click();
    await freshPage.getByText("Sign Out").click();
    await freshPage.waitForURL(/\/(login)?$/, { timeout: 15_000 });

    // Now try to access a protected route
    await freshPage.goto("/dashboard");

    // Should be redirected to /login
    await freshPage.waitForURL(/\/login/, { timeout: 15_000 });
    expect(freshPage.url()).toContain("/login");
  });

  test("after sign out, navbar shows Log In and Sign Up buttons", async ({
    freshPage,
  }) => {
    await freshPage.goto("/ideas");
    await expect(freshPage).toHaveURL(/\/ideas/, { timeout: 15_000 });

    // Sign out
    const avatarButton = freshPage
      .locator("nav")
      .locator("button")
      .filter({ has: freshPage.locator("span.relative, [data-slot='avatar']") })
      .first();
    await expect(avatarButton).toBeVisible({ timeout: 15_000 });
    await avatarButton.click();
    await freshPage.getByText("Sign Out").click();
    await freshPage.waitForURL(/\/(login)?$/, { timeout: 15_000 });

    // Navbar should show unauthenticated state
    await expect(
      freshPage.getByRole("link", { name: /log in/i })
    ).toBeVisible({ timeout: 10_000 });
    await expect(
      freshPage.getByRole("link", { name: /sign up/i })
    ).toBeVisible();
  });
});
