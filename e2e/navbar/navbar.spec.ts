import { test, expect } from "../fixtures/auth";
import { ensureFreshPageAuthenticated } from "../fixtures/fresh-auth";

test.describe("Navbar", () => {
  test("active nav state on current route", async ({ userAPage }) => {
    // Navigate to /ideas — "Ideas" button should have active (secondary) variant
    await userAPage.goto("/ideas");

    const ideasButton = userAPage
      .locator("nav")
      .getByRole("button", { name: /^ideas$/i })
      .first();
    await expect(ideasButton).toBeVisible({ timeout: 15_000 });

    // Navigate to /agents and check that Agents is now active
    await userAPage.goto("/agents");

    const agentsButton = userAPage
      .locator("nav")
      .getByRole("button", { name: /^agents$/i })
      .first();
    await expect(agentsButton).toBeVisible({ timeout: 15_000 });
  });

  test("logo links to /dashboard when authenticated", async ({ userAPage }) => {
    await userAPage.goto("/ideas");

    // Click the logo (VibeCodes text or the sparkles icon link)
    const logoLink = userAPage.locator("nav a").filter({ hasText: "VibeCodes" }).first();
    await expect(logoLink).toBeVisible({ timeout: 15_000 });
    await logoLink.click();

    // Should navigate to /dashboard
    await userAPage.waitForURL("**/dashboard", { timeout: 15_000 });
    expect(userAPage.url()).toContain("/dashboard");
  });

  // Use freshPage (separate user) for sign out to avoid revoking shared auth tokens
  test("sign out redirects away from protected routes", async ({ freshPage }) => {
    // Navigate to /ideas — use /ideas instead of /dashboard to avoid onboarding dialog
    // (fresh user has no onboarding_completed_at, dashboard shows un-dismissable dialog)
    await ensureFreshPageAuthenticated(freshPage, "/ideas");

    // Open the user dropdown menu (click the avatar button)
    const avatarButton = freshPage
      .locator("nav")
      .locator("button")
      .filter({ has: freshPage.locator("span.relative, [data-slot='avatar']") })
      .first();
    await expect(avatarButton).toBeVisible({ timeout: 15_000 });
    await avatarButton.click();

    // Click "Sign Out" in the dropdown
    const signOutItem = freshPage.getByText("Sign Out");
    await expect(signOutItem).toBeVisible({ timeout: 5_000 });
    await signOutItem.click();

    // Should redirect away from the dashboard — to either "/" or "/login"
    // (router.push("/") fires, but middleware may also redirect to /login)
    await freshPage.waitForURL(/\/(login)?$/, { timeout: 15_000 });
    const url = new URL(freshPage.url());
    expect(url.pathname === "/" || url.pathname === "/login").toBe(true);
  });

  test("theme toggle switches between dark and light", async ({ userAPage }) => {
    await userAPage.goto("/dashboard");

    // For authenticated users, theme toggle is inside the user dropdown menu.
    // Open the avatar dropdown first.
    const avatarButton = userAPage
      .locator("nav")
      .locator("button")
      .filter({ has: userAPage.locator("span.relative, [data-slot='avatar']") })
      .first();
    await expect(avatarButton).toBeVisible({ timeout: 15_000 });
    await avatarButton.click();

    const themeToggle = userAPage.getByRole("menuitem", { name: /toggle theme/i });
    await expect(themeToggle).toBeVisible({ timeout: 5_000 });

    // Check current theme class on html element
    const initialTheme = await userAPage.evaluate(() =>
      document.documentElement.classList.contains("dark") ? "dark" : "light"
    );

    // Click to toggle
    await themeToggle.click();

    // Wait for theme transition
    await userAPage.waitForTimeout(500);

    // Verify the theme changed
    const newTheme = await userAPage.evaluate(() =>
      document.documentElement.classList.contains("dark") ? "dark" : "light"
    );
    expect(newTheme).not.toBe(initialTheme);

    // Re-open dropdown and toggle back to restore original state
    await avatarButton.click();
    const themeToggle2 = userAPage.getByRole("menuitem", { name: /toggle theme/i });
    await expect(themeToggle2).toBeVisible({ timeout: 5_000 });
    await themeToggle2.click();
    await userAPage.waitForTimeout(500);

    const restoredTheme = await userAPage.evaluate(() =>
      document.documentElement.classList.contains("dark") ? "dark" : "light"
    );
    expect(restoredTheme).toBe(initialTheme);
  });
});
